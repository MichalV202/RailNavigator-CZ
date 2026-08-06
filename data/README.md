# Železniční data

Do této složky patří zmenšený soubor `dmvs-railways.geojson` vytvořený z veřejné stavové sady DI. Do GitHub Pages nevkládejte původní krajské ZIP/JVF balíčky: jsou příliš velké pro mobilní aplikaci.

GeoJSON DMVS obsahuje pouze liniové objekty os kolejí (`0100000021`) v souřadnicích EPSG:5514 a metadata:

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "source": "ČÚZK/DMVS",
    "license": "CC BY 4.0",
    "valid_to": "2026-07-31",
    "retrieved_at": "2026-08-03"
  },
  "features": []
}
```

Aktuální verze obsahuje 2 343 unikátních os kolejí z 18 územních balíčků pro koridor Brno-Maloměřice – Kyjov a přilehlá kolejiště, platných k 31. 7. 2026.

Soubor `osm-railways.geojson` obsahuje 3 354 železničních linií z dodaného exportu OpenStreetMap pro stejnou oblast. Slouží k doplnění názvů, čísel kolejí, vleček a jako záložní geometrie. Oba soubory jsou součástí offline cache aplikace.
