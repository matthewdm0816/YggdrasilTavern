from app.services.chub_import import chub_project_to_character, chub_project_to_worldbook, parse_chub_reference


def test_parse_chub_character_reference_from_url():
    ref = parse_chub_reference("https://chub.ai/characters/alice/luna-card", "characters")
    assert ref.namespace == "characters"
    assert ref.creator == "alice"
    assert ref.project == "luna-card"


def test_chub_character_project_maps_definition_fields():
    card = chub_project_to_character(
        {
            "node": {
                "name": "Luna",
                "description": "Public description",
                "tagline": "A guide",
                "topics": ["fantasy"],
                "avatar_url": "https://example.test/luna.png",
                "definition": {
                    "personality": "A moonlit guide.",
                    "tavern_personality": "Kind and cryptic.",
                    "scenario": "At the gate.",
                    "first_message": "Welcome.",
                    "example_dialogs": "{{char}}: Hello",
                    "system_prompt": "Stay in character.",
                },
            }
        }
    )
    assert card.name == "Luna"
    assert card.description == "A moonlit guide."
    assert card.personality == "Kind and cryptic."
    assert card.first_mes == "Welcome."
    assert card.avatar_data_url == "https://example.test/luna.png"


def test_chub_lorebook_project_maps_character_book():
    book = chub_project_to_worldbook(
        {
            "node": {
                "name": "Moon Lore",
                "description": "Lore desc",
                "definition": {
                    "book": {
                        "scan_depth": 5,
                        "token_budget": 800,
                        "entries": [
                            {
                                "keys": ["moon"],
                                "secondary_keys": ["gate"],
                                "content": "Moon gates fold space.",
                                "selective": True,
                                "insertion_order": 4,
                            }
                        ],
                    }
                },
            }
        }
    )
    assert book.name == "Moon Lore"
    assert book.scan_depth == 5
    assert book.entries[0].keys == ["moon"]
    assert book.entries[0].secondary_keys == ["gate"]
    assert book.entries[0].order == 4
