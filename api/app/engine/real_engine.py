"""The real engine: every number comes from versioned rule data chosen by the competence (YYYY-MM) it is created for.

Port of `src/engine/real-engine.ts`. Company diagnosis per regime (Simples, MEI, Presumido, Real) plus the Folha, ICMS and
ISS lines; each result lists the rule versions it used and a calculation memory (`steps`).
"""

from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from typing import Any

from app.engine.format import brl, number_pt
from app.engine.icms import icms_month
from app.engine.irpf import PersonDiagnosis, diagnose_person
from app.engine.iss import iss_month
from app.engine.lucro_real import lucro_real_quarter, pis_cofins_month
from app.engine.mei import check_mei_limit, mei_das
from app.engine.money import from_cents, to_cents
from app.engine.opportunities import OpportunityContext, OpportunitySet, found_opportunities
from app.engine.payroll import PayrollInput, payroll_charges, pro_labore_retention
from app.engine.presumido import presumido_quarter, spread_over_months
from app.engine.result import EngineResult, InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion, competence_of, ref_of
from app.engine.rules_data import default_rulebook
from app.engine.simples import annex_by_fator_r, fator_r, rbt12_of, simples_das
from app.engine.types import DISCLAIMER, CalcStep, CompanyProfile, Diagnosis, PersonProfile, TaxLine, month_revenue

_TAX_CODE = {
    "IRPJ": "IRPJ",
    "CSLL": "CSLL",
    "COFINS": "PIS/COFINS",
    "PIS": "PIS/COFINS",
    "CPP": "CPP",
    "ICMS": "ICMS",
    "ISS": "ISS",
    "IPI": "IPI",
}
ZERO = Decimal(0)
type Rule = RuleVersion[dict[str, Any]]


def _loc(value: Decimal | int) -> str:
    """`toLocaleString("pt-BR")`: up to three decimals, trailing zeros dropped."""
    return number_pt(value, 3, min_digits=0)


def _pct(fraction: Decimal | int | str, digits: int) -> str:
    return number_pt(Decimal(str(fraction)) * 100, digits)


def _bc(cents: int) -> str:
    return brl(from_cents(cents))


def _quarter(competence: str) -> list[str]:
    year, month = (int(p) for p in competence.split("-"))
    start = (month - 1) // 3 * 3 + 1
    return [f"{year}-{start + i:02d}" for i in range(3)]


def _ratio(numerator: int, denominator: int) -> Decimal:
    return Decimal(numerator) / denominator if denominator > 0 else ZERO


@dataclass(frozen=True)
class Simulation:
    current: Diagnosis
    scenario: Diagnosis


def _step(rule: Rule, tax: str | None, label: str, formula: str, cents: int) -> CalcStep:
    return CalcStep(label, formula, from_cents(cents), rule.id, rule.source, tax)


class RealEngine:
    """Same questions as the mock engine, but backed by the rule book of the competence. Example: `RealEngine("2026-03")`."""

    def __init__(self, competence: str | None = None, book: RuleBook | None = None) -> None:
        self.competence = competence or competence_of(date.today())
        self.book = book or default_rulebook()
        self.version = f"real-{self.competence}"

    def _rule(self, rule_id: str) -> Rule | None:
        found: Rule | None = self.book.at(rule_id, self.competence)
        return found

    # ---- person ----
    def diagnose_person(self, profile: PersonProfile) -> EngineResult[PersonDiagnosis]:
        return diagnose_person(self.book, self.competence, profile)

    # ---- company, by regime ----
    def _simples(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        competence = self.competence
        rule = self._rule("simples-anexos")
        if rule is None:
            return NotApplicable(f"Não há tabela do Simples Nacional em vigor para a competência {competence}.")
        rbt = rbt12_of(p.series, competence)
        if rbt is None:
            return InsufficientData(["series"])
        entry = next((e for e in p.series or [] if e.month == competence), None)
        revenue = month_revenue(entry) if entry else p.monthly_revenue
        if revenue is None:
            return InsufficientData(["monthlyRevenue"])
        ratio = fator_r(p.series, competence)
        annex = p.anexo
        notes: list[str] = []
        if p.fator_r:
            if ratio is None:
                return InsufficientData(["payroll"])
            annex = annex_by_fator_r(ratio, rule.data)
            which = "Anexo III (28% ou mais)" if annex == "III" else "Anexo V (abaixo de 28%)"
            notes.append(f"Fator R de {_pct(ratio, 2)}%: {which}.")
        if not annex:
            if p.activity == "comercio":
                annex = "I"
            else:
                return InsufficientData(["anexo"])
        calc = simples_das(rule.data, annex, rbt.value, revenue)
        if calc is None:
            return NotApplicable(
                f"A receita dos últimos 12 meses (R$ {_loc(rbt.value)}) passa do limite de R$ {_loc(rule.data['limit'])}: "
                "a empresa sai do Simples Nacional."
            )
        by_code: dict[str, int] = {}
        for tax, cents in calc.lines:
            code = _TAX_CODE[tax]
            by_code[code] = by_code.get(code, 0) + cents
        breakdown = [TaxLine(tax, tax, from_cents(c)) for tax, c in by_code.items()]
        revenue_c = to_cents(revenue)
        band = rule.data["annexes"][calc.annex][calc.band - 1]
        annualised = f" (média de {rbt.months_used} mês(es) anualizada: empresa com menos de 12 meses)" if rbt.annualised else ""
        rbt_c = to_cents(rbt.value)
        effective = _pct(calc.effective_rate, 4)
        steps = [
            _step(
                rule,
                None,
                "Receita dos últimos 12 meses (RBT12)",
                f"soma da receita dos 12 meses anteriores a {competence} = {_bc(rbt_c)}",
                rbt_c,
            ),
            _step(
                rule,
                None,
                "Alíquota efetiva",
                f"(RBT12 {_bc(rbt_c)} × alíquota nominal {_pct(calc.nominal_rate, 2)}% − parcela a deduzir "
                f"{_bc(to_cents(band['deduction']))}) ÷ RBT12 = {effective}% (Anexo {calc.annex}, {calc.band}ª faixa)",
                0,
            ),
            _step(
                rule,
                None,
                "DAS do mês",
                f"receita do mês {_bc(revenue_c)} × {effective}% = {_bc(calc.das_cents)}",
                calc.das_cents,
            ),
            *(
                _step(
                    rule,
                    tax,
                    f"{tax} dentro do DAS",
                    f"{_bc(calc.das_cents)} do DAS × partilha do Anexo {calc.annex}, {calc.band}ª faixa = {_bc(c)}",
                    c,
                )
                for tax, c in by_code.items()
            ),
        ]
        return Ok(
            Diagnosis(
                monthly_revenue=revenue,
                monthly_total=from_cents(calc.das_cents),
                annual_total=from_cents(calc.das_cents * 12),
                effective_rate=_ratio(calc.das_cents, revenue_c),
                breakdown=breakdown,
                assumptions=[
                    f"Simples Nacional, Anexo {calc.annex}, {calc.band}ª faixa (alíquota nominal {_pct(calc.nominal_rate, 2)}%).",
                    f"Receita dos últimos 12 meses: R$ {_loc(rbt.value)}{annualised}.",
                    f"Alíquota efetiva de {effective}%.",
                    *notes,
                    *calc.notes,
                    "Tabelas ainda aguardam validação de um profissional.",
                    f"Regras versão {self.version}.",
                ],
                disclaimer=DISCLAIMER,
                rules_version=self.version,
                rules_used=[ref_of(rule)],
                steps=steps,
            )
        )

    def _mei(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        competence = self.competence
        rule = self._rule("mei-das")
        if rule is None:
            return NotApplicable(f"Não há tabela do MEI em vigor para a competência {competence}.")
        year = int(competence[:4])
        entries = [e for e in p.series or [] if e.month.startswith(f"{year}-") and e.month <= competence]
        if not entries and p.monthly_revenue is None:
            return InsufficientData(["series"])
        ytd = sum((month_revenue(e) for e in entries), ZERO)
        month_entry = next((e for e in entries if e.month == competence), None)
        revenue = month_revenue(month_entry) if month_entry else (p.monthly_revenue or ZERO)
        activity: Any = p.mei_activity or ("servico" if p.activity == "servico" else "comercio")
        das = mei_das(rule.data, activity)
        month_number = int(competence[5:7])
        limit = check_mei_limit(rule.data, ytd if entries else (p.monthly_revenue or ZERO) * month_number, p.opened_at, year)
        breakdown = [TaxLine("CPP", "INSS (previdência do MEI)", from_cents(das.inss_cents))]
        if das.icms_cents:
            breakdown.append(TaxLine("ICMS", "ICMS", from_cents(das.icms_cents)))
        if das.iss_cents:
            breakdown.append(TaxLine("ISS", "ISS", from_cents(das.iss_cents)))
        wage = to_cents(rule.data["minimumWage"])
        inss_rate = rule.data["inssRateCargo"] if p.mei_activity == "transporte_cargas" else rule.data["inssRate"]
        steps = [
            _step(
                rule,
                "CPP",
                "INSS do MEI",
                f"{_pct(inss_rate, 0)}% × salário mínimo {_bc(wage)} = {_bc(das.inss_cents)}",
                das.inss_cents,
            ),
            *(
                [_step(rule, "ICMS", "ICMS fixo", f"valor fixo mensal = {_bc(das.icms_cents)}", das.icms_cents)]
                if das.icms_cents
                else []
            ),
            *(
                [_step(rule, "ISS", "ISS fixo", f"valor fixo mensal = {_bc(das.iss_cents)}", das.iss_cents)]
                if das.iss_cents
                else []
            ),
        ]
        return Ok(
            Diagnosis(
                monthly_revenue=revenue,
                monthly_total=from_cents(das.total_cents),
                annual_total=from_cents(das.total_cents * 12),
                effective_rate=_ratio(das.total_cents, to_cents(revenue)),
                breakdown=breakdown,
                assumptions=[
                    "MEI: o DAS é fixo por mês, não depende do faturamento.",
                    limit.message,
                    "Tabela ainda aguarda validação de um profissional.",
                    f"Regras versão {self.version}.",
                ],
                disclaimer=DISCLAIMER,
                rules_version=self.version,
                rules_used=[ref_of(rule)],
                steps=steps,
            )
        )

    def _presumido(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        competence = self.competence
        rule = self._rule("lucro-presumido-federal")
        if rule is None:
            return NotApplicable(f"Não há tabela do Lucro Presumido em vigor para a competência {competence}.")
        months = _quarter(competence)
        entries = [e for e in p.series or [] if e.month in months]
        quarter: dict[str, Decimal] = {}
        if entries:
            for e in entries:
                quarter["comercio"] = (
                    quarter.get("comercio", ZERO) + e.revenue.get("comercio", ZERO) + e.revenue.get("exportacao", ZERO)
                )
                quarter["industria"] = quarter.get("industria", ZERO) + e.revenue.get("industria", ZERO)
                quarter["servico"] = quarter.get("servico", ZERO) + e.revenue.get("servico", ZERO)
        else:
            if p.monthly_revenue is None:
                return InsufficientData(["monthlyRevenue"])
            quarter["servico" if p.activity == "servico" else "comercio"] = p.monthly_revenue * 3
        q = presumido_quarter(rule.data, quarter)
        idx = months.index(competence)

        def month(cents: int) -> int:
            return spread_over_months(cents)[idx]

        lines = [
            ("IRPJ", month(q.irpj_cents)),
            ("CSLL", month(q.csll_cents)),
            ("PIS/COFINS", month(q.pis_cents + q.cofins_cents)),
        ]
        total = sum(c for _, c in lines)
        month_revenue_c = spread_over_months(q.revenue_cents)[idx]
        has_additional = q.irpj_additional_cents > 0
        extra = (
            f", com adicional de 10% (R$ {_loc(from_cents(q.irpj_additional_cents))}) sobre o que passa de R$ 60.000 no trimestre"
            if has_additional
            else ""
        )
        additional = (
            f" + adicional de {_pct(rule.data['additionalRate'], 0)}% sobre o que passa de R$ 60.000,00 = {_bc(q.irpj_additional_cents)}"
            if has_additional
            else ""
        )
        steps = [
            _step(
                rule,
                "IRPJ",
                "IRPJ do trimestre",
                f"base presumida {_bc(q.irpj_base_cents)} × {_pct(rule.data['irpjRate'], 0)}%{additional} = {_bc(q.irpj_cents)}; "
                "um terço no mês",
                lines[0][1],
            ),
            _step(
                rule,
                "CSLL",
                "CSLL do trimestre",
                f"base presumida {_bc(q.csll_base_cents)} × {_pct(rule.data['csllRate'], 0)}% = {_bc(q.csll_cents)}; um terço no mês",
                lines[1][1],
            ),
            _step(
                rule,
                "PIS/COFINS",
                "PIS e COFINS do trimestre",
                f"receita {_bc(q.revenue_cents)} × ({_pct(rule.data['pisRate'], 2)}% + {_pct(rule.data['cofinsRate'], 0)}%) = "
                f"{_bc(q.pis_cents + q.cofins_cents)}; um terço no mês",
                lines[2][1],
            ),
        ]
        return Ok(
            Diagnosis(
                monthly_revenue=from_cents(month_revenue_c),
                monthly_total=from_cents(total),
                annual_total=from_cents(total * 12),
                effective_rate=_ratio(total, month_revenue_c) if q.revenue_cents > 0 else ZERO,
                breakdown=[TaxLine(t, t, from_cents(c)) for t, c in lines],
                assumptions=[
                    f"Lucro Presumido, apuração trimestral ({months[0]} a {months[2]}); o mês mostra um terço do trimestre.",
                    f"Base presumida do IRPJ de R$ {_loc(from_cents(q.irpj_base_cents))}{extra}.",
                    "Receita do trimestre lida da série mensal."
                    if entries
                    else "Sem série mensal: o trimestre foi estimado como 3 vezes o faturamento mensal informado.",
                    "IRPJ, CSLL, PIS e COFINS cumulativos. ICMS, ISS e encargos da folha aparecem em linhas próprias quando há dados "
                    "para eles. Exportação (isenção de PIS/COFINS) e atividades com presunção especial não foram tratadas à parte.",
                    "Tabelas ainda aguardam validação de um profissional.",
                    f"Regras versão {self.version}.",
                ],
                disclaimer=DISCLAIMER,
                rules_version=self.version,
                rules_used=[ref_of(rule)],
                steps=steps,
            )
        )

    def _real(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        competence = self.competence
        rule = self._rule("lucro-real-federal")
        if rule is None:
            return NotApplicable(f"Não há tabela do Lucro Real em vigor para a competência {competence}.")
        months = _quarter(competence)
        entries = [e for e in p.series or [] if e.month in months]
        missing: list[str] = []
        if not entries and p.monthly_revenue is None:
            missing.append("monthlyRevenue")
        if p.profit_margin is None:
            missing.append("profitMargin")
        if missing:
            return InsufficientData(missing)
        quarter_revenue = sum((month_revenue(e) for e in entries), ZERO) if entries else (p.monthly_revenue or ZERO) * 3
        month_entry = next((e for e in entries if e.month == competence), None)
        revenue = month_revenue(month_entry) if month_entry else (ZERO if entries else (p.monthly_revenue or ZERO))
        if month_entry and month_entry.purchases is not None:
            purchases = month_entry.purchases
        else:
            purchases = ZERO if entries else (p.monthly_purchases or ZERO)
        margin = p.profit_margin or ZERO
        q = lucro_real_quarter(rule.data, quarter_revenue * margin, p.tax_loss_balance or ZERO)
        pc = pis_cofins_month(rule.data, revenue, purchases)
        idx = months.index(competence)
        lines = [
            ("IRPJ", spread_over_months(q.irpj_cents)[idx]),
            ("CSLL", spread_over_months(q.csll_cents)[idx]),
            ("PIS/COFINS", pc.pis_cents + pc.cofins_cents),
        ]
        total = sum(c for _, c in lines)
        revenue_c = to_cents(revenue)
        if q.profit_cents <= 0:
            profit_text = (
                f"O trimestre tem prejuízo estimado de R$ {_loc(from_cents(-q.profit_cents))}: sem IRPJ e CSLL, e o prejuízo vira "
                f"saldo a compensar (R$ {_loc(from_cents(q.loss_balance_cents))})."
            )
        else:
            offset = (
                f"; compensação de prejuízo de R$ {_loc(from_cents(q.offset_cents))}, limitada a 30% do lucro"
                if q.offset_cents > 0
                else ""
            )
            profit_text = (
                f"Lucro estimado do trimestre: R$ {_loc(from_cents(q.profit_cents))} (receita × margem informada){offset}."
            )
        credits = (
            f"Créditos de PIS/COFINS de R$ {_loc(from_cents(pc.credit_cents))} supondo que todas as compras (R$ {_loc(purchases)}) dão "
            "direito a crédito: confira com as notas."
            if purchases > 0
            else "Sem compras informadas no mês: nenhum crédito de PIS/COFINS foi considerado."
        )
        offset_step = (
            f"; compensação de prejuízo {_bc(q.offset_cents)} (no máximo {_pct(rule.data['lossOffsetLimit'], 0)}% do lucro)"
            if q.offset_cents > 0
            else ""
        )
        additional = (
            f" + adicional de {_pct(rule.data['additionalRate'], 0)}% = {_bc(q.irpj_additional_cents)}"
            if q.irpj_additional_cents > 0
            else ""
        )
        steps = [
            _step(
                rule,
                None,
                "Lucro estimado do trimestre",
                f"receita {_bc(to_cents(quarter_revenue))} × margem informada {_pct(margin, 2)}% = {_bc(q.profit_cents)}{offset_step}",
                q.profit_cents,
            ),
            _step(
                rule,
                "IRPJ",
                "IRPJ do trimestre",
                f"base {_bc(q.base_cents)} × {_pct(rule.data['irpjRate'], 0)}%{additional} = {_bc(q.irpj_cents)}; um terço no mês",
                lines[0][1],
            ),
            _step(
                rule,
                "CSLL",
                "CSLL do trimestre",
                f"base {_bc(q.base_cents)} × {_pct(rule.data['csllRate'], 0)}% = {_bc(q.csll_cents)}; um terço no mês",
                lines[1][1],
            ),
            _step(
                rule,
                "PIS/COFINS",
                "PIS e COFINS do mês",
                f"(receita {_bc(revenue_c)} − compras com crédito {_bc(to_cents(purchases))}) × "
                f"({_pct(rule.data['pisRate'], 2)}% + {_pct(rule.data['cofinsRate'], 1)}%) = {_bc(lines[2][1])}",
                lines[2][1],
            ),
        ]
        return Ok(
            Diagnosis(
                monthly_revenue=revenue,
                monthly_total=from_cents(total),
                annual_total=from_cents(total * 12),
                effective_rate=_ratio(total, revenue_c),
                breakdown=[TaxLine(t, t, from_cents(c)) for t, c in lines],
                assumptions=[
                    f"Lucro Real, apuração trimestral ({months[0]} a {months[2]}); o mês mostra um terço de IRPJ e CSLL do trimestre. "
                    "PIS e COFINS são do próprio mês.",
                    profit_text,
                    credits,
                    "A margem informada foi tratada como lucro antes do IRPJ e da CSLL; o lucro real depende da escrituração, com "
                    "adições e exclusões. ICMS, ISS e encargos da folha aparecem em linhas próprias quando há dados para eles.",
                    "Tabelas ainda aguardam validação de um profissional.",
                    f"Regras versão {self.version}.",
                ],
                disclaimer=DISCLAIMER,
                rules_version=self.version,
                rules_used=[ref_of(rule)],
                steps=steps,
            )
        )

    # ---- extra lines ----
    def _with_payroll(self, p: CompanyProfile, result: EngineResult[Diagnosis]) -> EngineResult[Diagnosis]:
        if not isinstance(result, Ok) or p.regime == "mei":
            return result
        entry = next((e for e in p.series or [] if e.month == self.competence), None)
        if entry is None or (entry.payroll is None and entry.pro_labore is None):
            return result
        rule = self._rule("folha-encargos")
        if rule is None:
            return result
        in_das = p.regime == "simples" and p.anexo != "IV"
        data = PayrollInput(
            entry.payroll or ZERO, entry.pro_labore or ZERO, "das" if in_das else "guia", p.rat_grade, p.fap, p.terceiros_rate
        )
        c = payroll_charges(rule.data, data)
        ceiling = self._rule("inss-teto")
        retention = pro_labore_retention(ceiling.data, entry.pro_labore) if ceiling and entry.pro_labore else None
        d = result.value
        total = to_cents(d.monthly_total) + c.total_cents
        retention_text = (
            [
                f"Retenção de 11% do INSS sobre o pró-labore: R$ {_loc(from_cents(retention))} (descontada do sócio, não é custo da empresa)."
            ]
            if retention is not None
            else []
        )
        extra_rules = [ref_of(rule), *([ref_of(ceiling)] if ceiling and retention is not None else [])]
        step = _step(
            rule,
            "FOLHA",
            "Encargos sobre a folha",
            f"INSS patronal {_bc(c.inss_patronal_cents)} + RAT {_bc(c.rat_cents)} + terceiros {_bc(c.terceiros_cents)} + FGTS "
            f"{_bc(c.fgts_cents)} (folha {_bc(to_cents(entry.payroll or ZERO))}, pró-labore {_bc(to_cents(entry.pro_labore or ZERO))}) "
            f"= {_bc(c.total_cents)}",
            c.total_cents,
        )
        return Ok(
            replace(
                d,
                monthly_total=from_cents(total),
                annual_total=from_cents(total * 12),
                effective_rate=_ratio(total, to_cents(d.monthly_revenue)),
                breakdown=[
                    *d.breakdown,
                    TaxLine("FOLHA", "Folha (INSS patronal, RAT, terceiros, FGTS)", from_cents(c.total_cents)),
                ],
                assumptions=[
                    *d.assumptions,
                    f"Folha: INSS patronal R$ {_loc(from_cents(c.inss_patronal_cents))}, RAT R$ {_loc(from_cents(c.rat_cents))}, "
                    f"terceiros R$ {_loc(from_cents(c.terceiros_cents))}, FGTS R$ {_loc(from_cents(c.fgts_cents))}.",
                    *c.notes,
                    *retention_text,
                    "A desoneração da folha de setores específicos não foi considerada.",
                ],
                rules_used=[*d.rules_used, *extra_rules],
                steps=[*d.steps, step],
            )
        )

    def _with_icms(self, p: CompanyProfile, result: EngineResult[Diagnosis]) -> EngineResult[Diagnosis]:
        if not isinstance(result, Ok) or p.regime not in ("presumido", "real"):
            return result
        d = result.value

        def note(text: str) -> EngineResult[Diagnosis]:
            return Ok(replace(d, assumptions=[*d.assumptions, text]))

        entry = next((e for e in p.series or [] if e.month == self.competence), None)
        # Only goods revenue carries ICMS; service revenue carries ISS.
        if entry:
            sales = (
                entry.revenue.get("comercio", ZERO) + entry.revenue.get("industria", ZERO) + entry.revenue.get("exportacao", ZERO)
            )
        elif p.activity == "servico":
            sales = ZERO
        else:
            sales = p.monthly_revenue if p.monthly_revenue is not None else d.monthly_revenue
        if sales <= 0:
            return note("Receita de serviços não paga ICMS: o ISS é calculado à parte.")
        purchases = entry.purchases if entry and entry.purchases is not None else (p.monthly_purchases or ZERO)
        r = icms_month(
            self.book, self.competence, uf=p.uf, sales=sales, purchases=purchases, substitution_tax=p.substituicao_tributaria
        )
        if isinstance(r, InsufficientData):
            return note("UF não informada: o ICMS não foi incluído no cálculo.")
        if not isinstance(r, Ok):
            return note(f"ICMS não incluído: {r.reason}" if isinstance(r, NotApplicable) else "ICMS não incluído.")
        v = r.value
        rule: Rule = self.book.require(f"icms-interno-{v.uf}", self.competence)
        total = to_cents(d.monthly_total) + v.due_cents
        carried = (
            f" (sobra de crédito de R$ {_loc(from_cents(v.carried_credit_cents))} para o mês seguinte)"
            if v.carried_credit_cents > 0
            else ""
        )
        step = _step(
            rule,
            "ICMS",
            f"ICMS ({v.uf})",
            f"débito {_bc(v.debit_cents)} (vendas {_bc(to_cents(sales))} × {_pct(v.rate, 2)}%) − crédito {_bc(v.credit_cents)} "
            f"(compras {_bc(to_cents(purchases))} × {_pct(v.rate, 2)}%) = {_bc(v.due_cents)}",
            v.due_cents,
        )
        return Ok(
            replace(
                d,
                monthly_total=from_cents(total),
                annual_total=from_cents(total * 12),
                effective_rate=_ratio(total, to_cents(d.monthly_revenue)),
                breakdown=[TaxLine("ICMS", f"ICMS ({v.uf})", from_cents(v.due_cents)), *d.breakdown],
                assumptions=[
                    *d.assumptions,
                    f"ICMS de {v.uf}: alíquota interna geral de {_pct(v.rate, 2)}%; débito de R$ {_loc(from_cents(v.debit_cents))} menos "
                    f"crédito de R$ {_loc(from_cents(v.credit_cents))} sobre as compras{carried}.",
                    "Supõe vendas internas tributadas pela alíquota geral e compras no mesmo estado com crédito integral: produtos "
                    "com alíquota ou base reduzida própria, vendas interestaduais e DIFAL não entram.",
                ],
                rules_used=[*d.rules_used, ref_of(rule)],
                steps=[*d.steps, step],
            )
        )

    def _with_iss(self, p: CompanyProfile, result: EngineResult[Diagnosis]) -> EngineResult[Diagnosis]:
        if not isinstance(result, Ok) or p.regime not in ("presumido", "real"):
            return result
        d = result.value
        entry = next((e for e in p.series or [] if e.month == self.competence), None)
        if entry:
            service = entry.revenue.get("servico", ZERO)
        elif p.activity == "servico":
            service = p.monthly_revenue if p.monthly_revenue is not None else d.monthly_revenue
        else:
            service = ZERO
        if service <= 0:
            return result

        def note(text: str) -> EngineResult[Diagnosis]:
            return Ok(replace(d, assumptions=[*d.assumptions, text]))

        r = iss_month(self.book, self.competence, service_revenue=service, rate=p.iss_rate)
        if isinstance(r, InsufficientData):
            where = f" ({p.municipio['name']})" if p.municipio else ""
            return note(
                f"ISS não incluído: informe a alíquota de ISS do seu município{where}, que está na sua nota fiscal ou na prefeitura."
            )
        if not isinstance(r, Ok):
            return note(f"ISS não incluído: {r.reason if isinstance(r, NotApplicable) else 'dados insuficientes'}")
        v = r.value
        limits: Rule = self.book.require("iss-limites", self.competence)
        total = to_cents(d.monthly_total) + v.due_cents
        step = _step(
            limits,
            "ISS",
            "ISS",
            f"serviços {_bc(v.base_cents)} × alíquota informada {_pct(v.rate, 2)}% (limites legais 2% a 5%) = {_bc(v.due_cents)}",
            v.due_cents,
        )
        return Ok(
            replace(
                d,
                monthly_total=from_cents(total),
                annual_total=from_cents(total * 12),
                effective_rate=_ratio(total, to_cents(d.monthly_revenue)),
                breakdown=[*d.breakdown, TaxLine("ISS", "ISS", from_cents(v.due_cents))],
                assumptions=[
                    *d.assumptions,
                    f"ISS de {_pct(v.rate, 2)}% sobre R$ {_loc(from_cents(v.base_cents))} de serviços (alíquota informada, dentro do "
                    "limite legal de 2% a 5%).",
                    "ISS retido pelo tomador, deduções da base e regimes especiais do município não foram considerados.",
                ],
                rules_used=[*d.rules_used, ref_of(limits)],
                steps=[*d.steps, step],
            )
        )

    # ---- public API ----
    def _regime(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        if p.regime == "simples":
            return self._simples(p)
        if p.regime == "mei":
            return self._mei(p)
        if p.regime == "presumido":
            return self._presumido(p)
        return self._real(p)

    def diagnose(self, p: CompanyProfile) -> EngineResult[Diagnosis]:
        return self._with_payroll(p, self._with_iss(p, self._with_icms(p, self._regime(p))))

    def simulate(self, p: CompanyProfile, overrides: dict[str, Any]) -> EngineResult[Simulation]:
        current = self.diagnose(p)
        if not isinstance(current, Ok):
            return current
        scenario = self.diagnose(replace(p, **overrides))
        return Ok(Simulation(current.value, scenario.value)) if isinstance(scenario, Ok) else scenario

    def opportunities(self, p: CompanyProfile) -> EngineResult[OpportunitySet]:
        found = found_opportunities(OpportunityContext(self, p, self.competence, self.book))
        return Ok(found) if found else NoneFound()

    def rules(self) -> RuleBook:
        return self.book
