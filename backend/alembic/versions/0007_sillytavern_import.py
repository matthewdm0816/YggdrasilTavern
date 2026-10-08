"""Store import provenance, saved credentials and defaults for new sessions."""

from alembic import op

revision = "0007_sillytavern_import"
down_revision = "0006_single_streaming_generation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create(checkfirst=True) also supports adoption of pre-Alembic databases.
    from app.models import DefaultSessionConfig, ImportedResource, SavedCredential

    for model in (ImportedResource, SavedCredential, DefaultSessionConfig):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    for table in ("default_session_config", "saved_credentials", "imported_resources"):
        op.drop_table(table)
