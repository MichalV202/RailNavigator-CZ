// RailNavigator CZ 0.1.0


// vytvoření mapy

const map = L.map('map')
    .setView(
        [49.2181083,16.6494211],
        16
    );


// základní mapa

L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        maxZoom:19,
        attribution:
        '© OpenStreetMap'
    }
).addTo(map);


// testovací rychlost

let speed = 0;


setInterval(()=>{

    document.getElementById(
        "speed-value"
    ).innerHTML =
    speed;

},500);



// tlačítko sever

document
.getElementById(
    "north-button"
)
.onclick = ()=>{

    map.setView(
        map.getCenter(),
        map.getZoom()
    );

};