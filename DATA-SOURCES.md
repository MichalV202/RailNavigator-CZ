# Datové zdroje a licence

## ČÚZK / DMVS

RailNavigator CZ umí použít veřejnou část dat dopravní infrastruktury z Digitální mapy veřejné správy (DMVS), konkrétně objekt `0100000021` — osa koleje železniční tratě.

- Poskytovatel: Český úřad zeměměřický a katastrální (ČÚZK)
- Zdroj: https://dmvs.cuzk.gov.cz/portal/vydej-dat/verejne-datove-sady
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Text licence: https://creativecommons.org/licenses/by/4.0/
- Povinné označení ve výstupu: `ČÚZK, [rok aktuálnosti dat]`

Při každé aktualizaci souboru `data/dmvs-railways.geojson` musí být zachovány položky `source`, `license`, `valid_to` a `retrieved_at` v objektu `metadata`. Aplikace zobrazuje zdroj v informačním panelu a úplnou atribuci v mapě.

Veřejná sada DI neobsahuje neveřejná data technické infrastruktury ani interní TTP. Z dat DMVS proto nelze bez dalšího zdroje odvozovat provozní rychlosti, aktuální výluky nebo závazný traťový sklon.

## OpenStreetMap a OpenRailwayMap

OpenStreetMap se používá jako lokální záložní geometrie a doplňkový zdroj označení kolejí a vleček. Soubor `data/osm-railways.geojson` je výřez dodaného exportu pro oblast Brno–Kyjov. Aplikace během jízdy neodesílá dotazy na Overpass API. Přenos označení na geometrii DMVS probíhá pouze za běhu aplikace a zdroj označení se uchovává samostatně.

- Zdroj: https://www.openstreetmap.org/
- Licence databáze: Open Data Commons Open Database License (ODbL)
- Autorská práva: přispěvatelé OpenStreetMap

Mapové dlaždice železniční vrstvy poskytuje OpenRailwayMap. Atribuce OpenStreetMap, OpenRailwayMap a ČÚZK je zobrazena přímo v mapě.

## Bezpečnostní upozornění

RailNavigator CZ je orientační testovací pomůcka. Není schváleným železničním zabezpečovacím, navigačním ani provozním systémem a jeho údaje nesmí nahrazovat návěsti, TTP, rozkazy ani jiné závazné provozní podklady.
