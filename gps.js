// RailNavigator CZ 0.1.1
// GPS modul


let trainMarker = null;


// vlastní ikona vlaku

const trainIcon = L.divIcon({

    className: "train-icon",

    html: "🚆",

    iconSize: [40,40],

    iconAnchor: [20,20]

});



// spuštění GPS

function startGPS(){


    if(!navigator.geolocation){

        alert(
            "Toto zařízení nepodporuje GPS"
        );

        return;

    }


    navigator.geolocation.watchPosition(

        position => {


            const lat =
            position.coords.latitude;


            const lon =
            position.coords.longitude;


            const speedMS =
            position.coords.speed;



            // převod m/s na km/h

            let speedKMH = 0;


            if(speedMS){

                speedKMH =
                Math.round(
                    speedMS * 3.6
                );

            }



            // aktualizace rychloměru

            document.getElementById(
                "speed-value"
            ).innerHTML =
            speedKMH;



            // první vytvoření vlaku

            if(!trainMarker){


                trainMarker =
                L.marker(

                    [lat,lon],

                    {
                        icon: trainIcon
                    }

                )
                .addTo(map);


                map.setView(
                    [lat,lon],
                    17
                );


            }

            else{


                trainMarker.setLatLng(

                    [lat,lon]

                );


            }



        },


        error => {

            console.log(
                "GPS chyba:",
                error.message
            );

        },


        {

            enableHighAccuracy:true,

            maximumAge:1000,

            timeout:10000

        }


    );

}


startGPS();