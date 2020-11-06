const map = L.map("map").setView([38.9530, -77.0270], 11);

L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
    maxZoom: 18,
    id: 'mapbox/light-v9',
    tileSize: 512,
    zoomOffset: -1,
    accessToken: 'pk.eyJ1Ijoib3Blbi1hZGRyZXNzZXMiLCJhIjoiSGx0a1B1NCJ9.2O1QelK6jnFXfDznC2pNSw'
}).addTo(map);

fetch('/data.json')
.then(response => response.json())
.then(stations => {
  const buffer = turf.buffer(stations, 0.8);
  const bbox = turf.bbox(stations);
  const voronoi = turf.voronoi(stations, {bbox: bbox});

  const len = buffer.features.length;
  const catchment = {"type": "FeatureCollection", "features": []};

  // get the intersection of each buffer and voronoi polygon, and put it into catchment's features
  for (let i = 0; i < len; i++) {
    const c = turf.intersect(buffer.features[i], voronoi.features[i]);
    c.properties = buffer.features[i].properties;
    catchment.features.push(c);
  }

  // initialize catchment areas on the map
  const catchmentGeojson = L.geoJson(catchment, {
    style: _ => {
      return {
        opacity: 0,
        fillOpacity: 0
      }
    }
  }).addTo(map);

  const getQuartile = data => {
    /**
     *  Get the first, second and third quartiles of the input
     * 
     *  @param {Object} data  JavaScript Object with properties being numbers, e.g. {pen: 3, pencil: 2, ruler: 5}
     * 
     *  @return {array} An array which includes the first, second and third quartiles of the input
     */
    const entries = Object.entries(data);
    const sorted = entries.sort((a, b) => a[1] - b[1]);
    const percentiles = [25, 50, 75];

    const res = []
    
    for (let i = 0; i < percentiles.length; i++) {
      const index = (percentiles[i] / 100) * sorted.length;

      if (Math.floor(index) == index) {
        res.push((sorted[index - 1][1] + sorted[index][1]) / 2);
      }
      else {
        res.push(sorted[Math.floor(index)][1]);
      }
    }
    
    return res;
  }

  const getColor = (name, trips, q1, q2, q3) => {
    /**
     *  Generate color scheme according to quartiles
     *  
     *  @param {string} name  Name of bikeshare station
     *  @param {Object} trips JavaScript Object with properties being numbers
     *  @param {number} q1    First quartile of trips
     *  @param {number} q2    Second quartile of trips
     *  @param {number} q3    Third quartile of trips
     * 
     *  @return {string}      Hex code of corresponding color
     */

    return trips[name] >= q3  ? '#800026' :
           trips[name] >= q2  ? '#E31A1C' :
           trips[name] >= q1  ? '#FD8D3C' :
                                '#FC4E2A';
  }

  const getFillOpacity = (name, trips, q1, q2, q3) => {
    /**
     *  Generate fill opacity scheme according to quartiles
     *  
     *  @param {string} name  Name of bikeshare station
     *  @param {Object} trips JavaScript Object with properties being numbers
     *  @param {number} q1    First quartile of trips
     *  @param {number} q2    Second quartile of trips
     *  @param {number} q3    Third quartile of trips
     * 
     *  @return {number}      fill opacity of corresponding color, 0 if name is not found in trips
     */
    if (!trips[name]) {
      return 0;
    }

    return trips[name] >= q3  ? 0.8 :
           trips[name] >= q2  ? 0.6 :
           trips[name] >= q1  ? 0.4 :
                                0.2;
  }

  const adjustFeatureColor = e => {
    /**
     * Will be triggered whenever a mouseover event happens and will 
     * adjust the color of every single feature
     * 
     * @param {Event} e
     */
    const feature = e.sourceTarget.feature;
    // Get the trip counts object
    const trips = feature.properties["to"];
    // Get the name of bikeshare station whose catchment area is hovered
    const currStationName = feature.properties["station_name"];

    // Calculate quartiles
    const quartile = getQuartile(trips);
    const q1 = quartile[0], q2 = quartile[1], q3 = quartile[2];
    
    // update catchmentGeojson's style based on the bikeshare station being hovered
    catchmentGeojson.setStyle(feature => {
      const stationName = feature.properties["station_name"];

      return {
        fillColor: getColor(stationName, trips, q1, q2, q3),
        fillOpacity: getFillOpacity(stationName, trips, q1, q2, q3)
      };
    });

    // also update the info panel
    info.update(currStationName, trips);
  }

  const reset = e => {
    /**
     * Will be triggered whenever a mouseout event happens
     * 
     * @param {Event} e
     */
    
    // reset style to default state
    catchmentGeojson.setStyle(_ => {
      return {
        opacity: 0,
        fillOpacity: 0
      }
    });

    // empty the info panel
    info.update();
  }

  // bind specific events to listeners
  catchmentGeojson.on("mouseover", adjustFeatureColor);
  catchmentGeojson.on("mouseout", reset);

  // Add station point features to map
  L.geoJson(stations, {
    pointToLayer: (_, latlng) => L.circleMarker(latlng, {
      color: 'black',
      fillOpacity: 0,
      radius: 1
    })
  }).addTo(map);

  // Add a custom control
  const info = L.control();

  info.onAdd = function (map) {
    this._div = L.DomUtil.create('div', 'info'); // create a div with a class "info"
    this.update();
    return this._div;
  };

  // generate info texts according to name of station and trip counts
  info.update = function (stationName, trips) {
    // if no station is being hovered
    if (!stationName || !trips) {
      this._div.innerHTML = "<h3>Hover over a station</h3>";
      return;
    }

    // sort the trip counts
    const entries = Object.entries(trips);
    const sorted = entries.sort((a, b) => b[1] - a[1]);

    // calculate total number of trips
    var sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += sorted[i][1];
    }

    // concatenate the text which will be shown in the info panel
    // focus on top 5 stations (if exists)
    var sortedText = "";
    for (let i = 0; i < Math.min(sorted.length, 5); i++) {
      sortedText += '<b>' + sorted[i][1] + ' </b>to ' + sorted[i][0] + '<br />';
    }

    this._div.innerHTML = 
    "<h3>From " + stationName + "</h3>" +
    "<hr style='border-top: 2px dotted #bbb;'>"+
    (sum != 0 ? sortedText + '<br /><b>' + sum + ' </b>to all stations' + '<br />' : 'No trips') +
    "<hr style='border-top: 2px dotted #bbb;'>"+
    "<p>A heatmap of aggregate bike trips throughout Washington DC from a selection station, \
    answering the question of 'where do people bike from here'. All the data are provided by \
    Capital Bikeshare and are from the second half of 2020. Each region roughly represents \
    the area within half a mile from the bikeshare station (i.e. places people would walk from/to).</p>"
  };
  
  info.addTo(map);
})
.catch(err => console.log(err));
