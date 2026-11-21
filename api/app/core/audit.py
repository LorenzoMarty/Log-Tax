"""The audit trail and the product funnel: both are appended through database functions as the signed-in caller."""

from typing import Literal, get_args

from app.core.errors import DbError
from app.core.logging import log
from app.db.client import UserDb

type AuditAction = Literal[
    "login",
    "invite_sent",
    "invite_revoked",
    "invite_accepted",
    "member_removed",
    "member_left",
    "document_uploaded",
    "document_deleted",
    "destructive_action",
    "data_exported",
    "account_deleted",
    "mfa_enabled",
    "mfa_disabled",
    "mfa_recovery_used",
    "report_link_created",
    "report_link_revoked",
    "report_link_opened",
    "agent_documents_changed",
]

AUDIT_LABEL: dict[str, str] = {
    "login": "Entrou no Log Tax",
    "invite_sent": "Convidou alguém",
    "invite_revoked": "Cancelou um convite",
    "invite_accepted": "Aceitou um convite",
    "member_removed": "Removeu um acesso",
    "member_left": "Saiu do espaço",
    "document_uploaded": "Enviou um documento",
    "document_deleted": "Apagou um documento",
    "destructive_action": "Confirmou uma ação destrutiva na conversa",
    "data_exported": "Exportou os dados",
    "account_deleted": "Excluiu a conta",
    "mfa_enabled": "Ativou a verificação em duas etapas",
    "mfa_disabled": "Desativou a verificação em duas etapas",
    "mfa_recovery_used": "Usou um código de recuperação",
    "report_link_created": "Criou um link do relatório",
    "report_link_revoked": "Revogou um link do relatório",
    "report_link_opened": "Alguém abriu um link do relatório",
    "agent_documents_changed": "Mudou os documentos que uma IA pode usar",
}
AUDIT_ACTIONS: tuple[str, ...] = get_args(AuditAction.__value__)


async def audit(db: UserDb, workspace_id: str | None, action: AuditAction, target: str | None = None) -> None:
    """Appends one event to the audit trail (the database stamps the actor). A failed write is logged, not fatal."""
    try:
        await db.rpc("audit_record", {"p_workspace": workspace_id, "p_action": action, "p_target": target})
    except DbError as exc:
        log.error("audit_failed", extra={"action": action, "db_status": exc.status})


# The steps of the journey (PRD §30), in funnel order. An event carries no value and no text: only the step.
FUNNEL = (
    "signed_in",
    "workspace_created",
    "first_diagnosis",
    "opportunities_viewed",
    "simulated",
    "alert_created",
    "agent_created",
)

FUNNEL_LABEL: dict[str, str] = {
    "signed_in": "Entrou",
    "workspace_created": "Criou um espaço",
    "first_diagnosis": "Viu o primeiro diagnóstico",
    "opportunities_viewed": "Viu oportunidades",
    "simulated": "Simulou um cenário",
    "alert_created": "Criou um alerta",
    "agent_created": "Criou uma IA",
}


async def track(db: UserDb, event: str) -> None:
    """Records a funnel step. The database drops it unless the person opted in, so callers never check consent."""
    if event not in FUNNEL:
        raise ValueError(f"unknown funnel event: {event}")
    try:
        await db.rpc("track_event", {"p_event": event})
    except DbError as exc:
        log.warning("track_failed", extra={"event_name": event, "db_status": exc.status})
