# Data DMVS

Do této složky patří zmenšený soubor `dmvs-railways.geojson` vytvořený z veřejné stavové sady DI. Do GitHub Pages nevkládejte původní krajské ZIP/JVF balíčky: jsou příliš velké pro mobilní aplikaci.

GeoJSON musí obsahovat pouze liniové objekty os kolejí (`0100000021`) v souřadnicích WGS 84 a metadata:

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

Aktuální verze obsahuje výřez trasy Brno-Maloměřice – Modřice platný k 31. 7. 2026. Pokrývá šest územních balíčků: Maloměřice a Obřany, Židenice, Černovice, Brno-střed, Brno-jih a Modřice. Obsahuje 2 607 liniových úseků os kolejí a je uložený také do offline cache aplikace.

Mimo pokrytí tohoto výřezu aplikace bezpečně používá OpenStreetMap a v panelu ukazuje `OSM (záloha)`.
