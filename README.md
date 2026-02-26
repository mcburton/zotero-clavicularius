# Zotero Clavicularius

*Zotero Clavicularius* (zo-TAIR-oh clav-ick-yoo-LAR-ee-us) — a Zotero 8 plugin that generates and manages *clavis citationum* (citation keys) for items in your library.

## Features

- Automatically generates citation keys for newly added items
- Configurable key template using simple tokens
- Live preview in preferences based on your currently selected item
- Bulk actions to backfill missing keys or rebuild all keys

## Installation

1. Download `zotero-clavicularius.xpi`
2. In Zotero: `Tools → Add-ons → ⚙ → Install Add-on From File`
3. Select the `.xpi` file and restart Zotero

To build from source:

```sh
git clone https://github.com/mcburton/zotero-clavicularius
cd zotero-clavicularius
zip -j zotero-clavicularius.xpi manifest.json bootstrap.js prefs.xhtml prefs.js
```

## Configuration

Open `Tools → Preferences → Clavicularius` to configure.

### Template tokens

| Token | Description | Example |
|---|---|---|
| `{auth}` | First author last name, lowercase | `dasmann` |
| `{Auth}` | First author last name, capitalized | `Dasmann` |
| `{year}` | 4-digit year (`nd` if absent) | `1974` |
| `{title}` | First N significant title words, CamelCase | `BioticProvincesWorld` |
| `{title_lower}` | First N significant title words, underscore-separated | `biotic_provinces_world` |

The default template is `{auth}{title}{year}`, producing keys like `dasmannBioticProvincesWorld1974`.

The number of title words (default: 3) is also configurable. Stop words (*a*, *the*, *of*, *in*, etc.) are excluded from the title component.

### Bulk actions

- **Backfill missing keys** — generates keys for all items in your library that do not already have one
- **Rebuild all keys** — regenerates keys for every item, overwriting existing ones (requires confirmation)

## Behavior

Once installed, Clavicularius watches for newly added items and generates a citation key automatically if none is present. Existing keys are never overwritten except via the explicit **Rebuild** action.

## License

CC0 1.0 Universal — Public Domain
