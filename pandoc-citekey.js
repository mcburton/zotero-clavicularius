{
	"translatorID": "a7f2e3b1-4c8d-4e9f-b123-5d6e7f8a9b0c",
	"label": "Clavicularius: Pandoc Citation Key",
	"creator": "Zotero Clavicularius",
	"target": "",
	"minVersion": "8.0",
	"maxVersion": "",
	"priority": 100,
	"translatorType": 2,
	"browserSupport": "gcsibv",
	"lastUpdated": "2026-03-03 00:00:00"
}

function doExport() {
	var item;
	var keys = [];
	while ((item = Zotero.nextItem())) {
		var key = item.citationKey;
		if (key) keys.push('@' + key);
	}
	Zotero.write(keys.join('; '));
}
