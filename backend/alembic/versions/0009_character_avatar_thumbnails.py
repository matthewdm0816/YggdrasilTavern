"""Persist list-sized character avatars and backfill existing characters."""

from alembic import op
import sqlalchemy as sa

revision = "0009_character_avatar_thumbnails"
down_revision = "0008_global_worldbook_regex"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.avatar_thumbnail import thumbnail_data_url

    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("characters")}
    if "avatar_thumbnail_data_url" not in columns:
        op.add_column("characters", sa.Column("avatar_thumbnail_data_url", sa.Text(), nullable=True))
    characters = sa.table(
        "characters",
        sa.column("id", sa.String()),
        sa.column("avatar_data_url", sa.Text()),
        sa.column("avatar_thumbnail_data_url", sa.Text()),
    )
    rows = bind.execute(sa.select(characters.c.id, characters.c.avatar_data_url).where(
        characters.c.avatar_data_url.is_not(None),
        characters.c.avatar_data_url != "",
        characters.c.avatar_thumbnail_data_url.is_(None),
    ))
    for character_id, avatar in rows:
        # Updating only the new column preserves character order and timestamps.
        bind.execute(characters.update().where(characters.c.id == character_id).values(
            avatar_thumbnail_data_url=thumbnail_data_url(avatar),
        ))


def downgrade() -> None:
    op.drop_column("characters", "avatar_thumbnail_data_url")
