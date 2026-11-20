"""The fictional companies of the demo mode (`LOG_TAX_DEMO_SEED=1`): never used for real workspaces."""

from decimal import Decimal

from app.engine.types import CompanyProfile, PersonProfile


def seed_company() -> CompanyProfile:
    return CompanyProfile(
        id="seed-company", name="Comercial Exemplo Ltda.", regime="presumido", activity="comercio",
        monthly_revenue=Decimal(350000), employees=8, uf="SP", monthly_purchases=Decimal(180000), profit_margin=Decimal("0.08"),
    )  # fmt: skip


def seed_person() -> PersonProfile:
    """Fictional salaried person with two dependents."""
    return PersonProfile(
        annual_gross_income=Decimal(180000), inss_paid=Decimal(11000), dependents=2,
        health_expenses=Decimal(12000), education_expenses=Decimal(9000), tax_withheld=Decimal(31500),
    )  # fmt: skip
