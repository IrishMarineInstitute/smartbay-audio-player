Date.prototype.hashformat = Date.prototype.hashformat || function() {
	return this.toJSON().toString().substring(0, 19);
}
// polyfill for nodeList forEach
NodeList.prototype.forEach = NodeList.prototype.forEach || Array.prototype.forEach;

var SmartbayAudioPlayer = function(el, options) {
	var player = this;
	this.options = options || {};
	this.options.width = this.options.width || '400';
	this.options.height = this.options.height || '128';
	this.options.infoClassName = this.options.infoClassName || 'text-info';
	this.options.errorClassName = this.options.errorClassName || "text-danger";
	this.options.baseUrl = this.options.baseUrl || "//spiddal.marine.ie/data/audio/ICListenRecordings/";

	this.options.indexUrlFunction = this.options.indexUrlFunction || function(baseUrl) {
		var today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
		return baseUrl + today + "/";
	};

	//Function for extracting urls from the index page.
	this.options.extractUrlsFunction = this.options.extractUrlsFunction || function(data, baseUrl) {
		var tmp = document.createElement("div");
		tmp.innerHTML = data;
		var hrefs = [];
		var nodeList = tmp.querySelectorAll('a[href$=".wav"]');
		nodeList.forEach(function(e) {
			hrefs.push(baseUrl + e.getAttribute('href'));
		});
		return hrefs;
	};

	// create the audio context (chrome only for now)
	if (!window.AudioContext) {
		if (!window.webkitAudioContext) {
			console.log('no audiocontext found - SmartbayAudioPlayer will not work in this browser...');
			return;
		}
		window.AudioContext = window.webkitAudioContext;
	}
	el = el ? document.getElementById(el) : null;
	if (!el) {
		el = document.createElement('div');
		document.body.appendChild(el);
	}
	// setup widget
	var canvas = document.createElement('canvas');
	canvas.setAttribute('id', 'canvas');
	canvas.setAttribute('width', this.options.width);
	canvas.setAttribute('height', this.options.height);
	canvas.setAttribute('style', 'display: block; background-color: black ;');
	el.appendChild(canvas);
	var div = document.createElement('div');
	this.timeElement = document.createElement('span');

	div.appendChild(this.timeElement);
	div.appendChild(document.createTextNode(" (UTC Time)"));
	el.appendChild(div);

	div = document.createElement('div');
	var div2 = document.createElement('div');
	var label = document.createElement('label');
	label.innerHTML = 'Volume ';
	div2.appendChild(label);
	var volumeControl = document.createElement('input');
	volumeControl.setAttribute('style', 'max-width: 200px');
	volumeControl.setAttribute('type', 'range');
	volumeControl.setAttribute('min', '0');
	volumeControl.setAttribute('max', '100');
	volumeControl.setAttribute('value', '25');
	volumeControl.setAttribute('id', 'volumeControl');
	volumeControl.addEventListener('input',
		function() {
			var fraction = parseInt(this.value) / parseInt(this.max);
			player.context.gainNode.gain.setTargetAtTime(fraction * 20.0, 0, 0.2);
		});

	div2.appendChild(volumeControl);
	div.appendChild(div2);
	el.appendChild(div);
	var p = document.createElement('p');
	p.className = this.options.infoClassName;
	this.infoElement = p;
	el.appendChild(p);
	div = document.createElement('div');
	div.className = this.options.errorClassName;
	this.errorElement = div;
	el.appendChild(div);

	this.context = new AudioContext();
	this.context.gainNode = this.context.createGain();
	this.context.gainNode.gain.setTargetAtTime(2.5, 0, 0.2);


	this.context.gainNode.connect(this.context.destination);

	this.currentRecording = {
		url: null
	};
	this.nextRecording = null;
	this.sourceNode;
	this.analyser;
	this.javascriptNode;
	this.canvasWidth = this.options.width;
	this.canvasHeight = this.options.height;
	this.fftSize = 256;

	// get the context from the canvas to draw on
	this.ctx = canvas.getContext("2d");

	// create a temp canvas we use for copying
	this.tempCanvas = document.createElement("canvas");
	this.tempCtx = this.tempCanvas.getContext("2d");
	this.tempCanvas.width = 1;
	this.tempCanvas.height = this.fftSize / 2;

	// used for color distribution
	this.hot = new chroma.scale(["#000000", "#33cc33", "#ffff00", "#ff9933", "#cc3300"]).domain([0, 1, 20, 40, 80]);
	// when the javascript node is called
	// we use information from the analyzer node
	// to draw the volume
	var player = this;
	//this.cbuff = new Array(canvasHeight);

	this.drawPlayButton();
	this.pause = true;
	canvas.addEventListener('click', function(evt) {
		player.pause = !player.pause;
		if (player.pause) {
			if (player.sourceNode) {
				player.sourceNode.stop(0);
			}
			setTimeout(player.drawPlayButton.bind(player), 200);
		} else {
			player.ctx.beginPath();
			player.ctx.rect(0, 0, player.options.width, player.options.height);
			player.ctx.fillStyle = "black";
			player.ctx.fill();
			if (player.currentRecording && player.currentRecording.url) {
				player.loadSound(player.currentRecording.url);
			} else {
				player.loadNextRecording();
			}
		}
	}, false);

	this.setupAudioNodes();
}

SmartbayAudioPlayer.prototype.drawPlayButton = function() {
	//https://stackoverflow.com/questions/24621286/draw-a-play-button-on-canvas-in-javascript-triangle-in-a-circle
	var w = this.options.width;
	var h = this.options.height;
	this.ctx.strokeStyle = 'white';
	this.ctx.beginPath();
	this.ctx.moveTo(w / 2 - h / 6, h / 3);
	this.ctx.lineTo(w / 2 - h / 6, h - h / 3);
	this.ctx.lineTo(w / 2 + h / 6, h / 2);
	this.ctx.lineTo(w / 2 - h / 6, h / 3);
	this.ctx.fillStyle = 'white';
	this.ctx.fill();
}

SmartbayAudioPlayer.prototype.debug = function(msg) {
	if (this.options.debug) {
		this.infoElement.appendChild(document.createElement("br"));
		this.infoElement.appendChild(document.createTextNode(msg));
	}
}
SmartbayAudioPlayer.prototype.loadNextRecording = function() {
	if (this.pause || this.nextRecording) {
		return;
	}
	if (!this.currentRecording.url) {
		this.infoElement.innerHTML = "Loading data.. this could take some time...";
	}

	var player = this;
	var index_url = this.options.indexUrlFunction(this.options.baseUrl);
	if (this.options.debug) this.debug("fetching " + index_url);
	fetch(index_url)
		.then(function(response) {
			return response.text();
		})
		.then(function(data) {
			var hrefs = player.options.extractUrlsFunction(data, index_url);
			if (player.options.debug) player.debug("extracted " + hrefs.length + " urls");
			if (hrefs && hrefs.length) {
				if (player.currentRecording.url) {
					var index = hrefs.findIndex(function(url) {
						return url > player.currentRecording.url;
					});
					if (index >= 0) {
						try {
							player.loadSound(hrefs[index]);
						} catch (e) {
							player.debug(e);
							setTimeout(player.loadNextRecording.bind(player), 2000);
						}
					} else {
						setTimeout(player.loadNextRecording.bind(player), 5000);
					}
				} else {
					try {
						player.loadSound(hrefs[hrefs.length - (hrefs.length > 1 ? 2 : 1)]);
					} catch (e) {
						player.debug(e);
					}
				}
			} else {
				player.showError("no wav files found");
			}
		}).catch(function(error) {
			player.showError(error.message)
		});
}

SmartbayAudioPlayer.prototype.createSourceNode = function() {
	var player = this;
	// create a buffer source node
	var node = player.context.createBufferSource();
	node.connect(player.analyser);
	//node.connect(context.destination);
	node.connect(player.context.gainNode);
	node.addEventListener('ended', function(e) {
		if (player.pause) {
			return;
		}
		player.currentRecording.url = null;
		if (player.nextRecording) {
			player.playSound(player.nextRecording.node, player.nextRecording.url, player.nextRecording.buffer);
			player.nextRecording = null;
		} else {
			if (!player.pause) {
				player.infoElement.innerHTML = "all done";
			}
		}
	}, false);
	return node;
}
SmartbayAudioPlayer.prototype.setupAudioNodes = function() {
	var player = this;

	// setup a javascript node
	player.javascriptNode = player.context.createScriptProcessor(player.fftSize, 1, 1);
	player.javascriptNode.onaudioprocess = function() {
		if (player.pause) {
			return;
		}
		// get the average for the first channel
		var array = new Uint8Array(player.analyser.frequencyBinCount);
		player.analyser.getByteFrequencyData(array);

		// draw the spectrogram
		if (player.sourceNode && player.sourceNode.playbackState == player.sourceNode.PLAYING_STATE) {
			player.drawSpectrogram(array);
			var time = player.currentRecording.offset_start_time + (player.context.currentTime * 1000);
			if (player.currentRecording.date.getTime() < time + 100) {
				player.currentRecording.date.setTime(time);
				player.timeElement.innerHTML = player.currentRecording.date.hashformat();
			}
		}


	}

	// connect to destination, else it isn't called
	player.javascriptNode.connect(player.context.destination);

	// setup an analyzer
	player.analyser = player.context.createAnalyser();
	player.analyser.smoothingTimeConstant = 0;
	player.analyser.fftSize = player.fftSize;
	player.analyser.minDecibels = -120;
	player.analyser.maxDecibels = -20;
	player.analyser.connect(player.javascriptNode);

}
SmartbayAudioPlayer.prototype.showError = function(msg) {
	this.infoElement.innerHTML = "";
	this.errorElement.innerHTML = "";
	if (msg) {
		this.errorElement.appendChild(document.createTextNode(msg));
		if ("" + msg == "EncodingError: Unable to decode audio data") {
			this.errorElement.appendChild(document.createElement("br"));
			this.errorElement.appendChild(document.createTextNode("(This error is known to happen on Chrome browser)"));
		}
		console.log(msg);
	}

}
// load the specified sound
SmartbayAudioPlayer.prototype.loadSound = function(url) {
	var player = this;
	var request = new XMLHttpRequest();
	request.open('GET', url, true);
	request.responseType = 'blob'; //'arraybuffer';

	// When loaded decode the data
	request.onload = function() {
		var audioHandler = function(buffer) {
			player.showError();
			node = player.createSourceNode();
			if (player.sourceNode == null || player.currentRecording.url == null || player.currentRecording.url == url) {
				player.playSound(node, url, buffer);
			} else {
				player.nextRecording = {
					node: node,
					url: url,
					buffer: buffer
				}
			}
		};
		var blobReader = new FileReader();
		var blob = request.response;
		blobReader.onload = function() {
			var arrayBuffer = this.result;
			player.context.decodeAudioData(arrayBuffer, audioHandler, function(e) {
				player.debug("Data not decoded:" + e + ". will try downsampling.");
				player.downsample(blob).then(function(resampled) {
					player.debug("Downsampling complete");
					player.context.decodeAudioData(resampled, audioHandler, function(e2) {
						player.debug("Could not parse downsampled data" + e2);
						player.showError(e);
					});
				});
			});
		};
		blobReader.onError = function() {
			//handled.
		};
		blobReader.readAsArrayBuffer(blob);
		//		player.debug("got "+request.response.byteLength+" bytes");
		// decode the data
	}
	request.send();
}

SmartbayAudioPlayer.prototype.parseTimeFromUrl = function(url) {
	var match = url.match(/^.*(\d{4})(\d{2})(\d{2}).(\d{2})(\d{2})(\d{2})Z{0,1}\.wav$/);
	return new Date("" + match[1] + "-" + match[2] + "-" + match[3] + "T" + match[4] + ":" + match[5] + ":" + match[6] + "Z");
}

SmartbayAudioPlayer.prototype.playSound = function(node, url, buffer) {
	// console.log("buffer.duration="+buffer.duration);
	this.infoElement.innerHTML = "";
	this.sourceNode = node;
	this.sourceNode.buffer = buffer;
	this.sourceNode.start(0);
	this.sourceNode.loop = false;
	this.currentRecording.url = url;
	var date = this.parseTimeFromUrl(url);
	this.currentRecording.date = date;
	this.currentRecording.offset_start_time = date.getTime() - (this.context.currentTime * 1000);
	setTimeout(this.loadNextRecording.bind(this), buffer.duration / 2 * 1000);
}

SmartbayAudioPlayer.prototype.drawSpectrogram = function(array) {
	var al = array.length;
	for (var i = 0; i < al; i++) {
		var value = array[i];
		this.tempCtx.fillStyle = this.hot(value).hex();
		this.tempCtx.fillRect(0, al - i, 1, 1);
	}
	var imageData = this.ctx.getImageData(0, 0, this.canvasWidth, this.canvasHeight);
	this.ctx.putImageData(imageData, -1, 0);

	this.ctx.drawImage(this.tempCanvas, 0, 0, 1, al, this.canvasWidth - 1, 0, 1, this.canvasHeight);

}

SmartbayAudioPlayer.prototype.downsample = function(blob) {
	return new Promise(function(resolve, reject) {
		var blobReader = new FileReader();
		blobReader.onloadend = function() {
			var readView = new DataView(this.result);
			//TODO verify it's a wav.
			if (readView.getUint32(0, true) != 1179011410 ||
				readView.getUint32(8, true) != 1163280727 ||
				readView.getUint32(12, true) != 544501094 ||
				readView.getUint32(36, true) != 1635017060) {
				reject(Error("File not appear to be a wav"));
				return;
			}
			if (readView.getUint32(16, true) != 16 ||
				readView.getUint16(20, true) != 1) {
				reject(Error("The wav format is not supported"));
				return;
			}
			var bitsPerSample = readView.getUint16(34, true);
			var sampleRate = readView.getUint32(24, true) / 2;
			var numChannels = readView.getUint16(22, true);
			var dataLength = readView.getUint32(40, true) / 2;
			var headerLength = 44;
			var buffer = new ArrayBuffer(headerLength + dataLength);
			var writeView = new DataView(buffer);
			writeView.setUint32(0, 1179011410, true); // byte 00, 4 bytes, RIFF Header
			writeView.setUint32(4, 36 + dataLength, true); // byte 04, 4 bytes, RIFF Chunk Size
			writeView.setUint32(8, 1163280727, true); // byte 08, 4 bytes, WAVE Header
			writeView.setUint32(12, 544501094, true); // byte 12, 4 bytes, FMT header
			writeView.setUint32(16, 16, true); // byte 16, 4 bytes, Size of the fmt chunk
			writeView.setUint16(20, 1, true); // byte 20, 2 bytes, Audio format 1=PCM,6=mulaw,7=alaw, 257=IBM Mu-Law, 258=IBM A-Law, 259=ADPCM
			writeView.setUint16(22, numChannels, true); // byte 22, 2 bytes, Number of channels 1=Mono 2=Sterio
			writeView.setUint32(24, sampleRate, true); // byte 24, 4 bytes, Sampling Frequency in Hz
			writeView.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // byte 28, 4 bytes, == SampleRate * NumChannels * BitsPerSample/8
			//nBlockAlign
			writeView.setUint16(32, numChannels * bitsPerSample / 8, true); // byte 32, 2 bytes, == NumChannels * BitsPerSample/8
			writeView.setUint16(34, bitsPerSample, true); // byte 34, 2 bytes, Number of bits per sample
			writeView.setUint32(36, 1635017060, true); // byte 36, 4 bytes, "data"  string
			writeView.setUint32(40, dataLength, true);
			var bytesPerSample = bitsPerSample / 8;
			var nblocks = dataLength / bytesPerSample;
			var pout = headerLength;
			var worker = function(start, limit) {
				var loop = 0;
				for (var block = start; block < nblocks; block++) {
					if (loop++ > limit) {
						setTimeout(worker.bind(null, block, limit), 0);
						return;
					}
					var pin = (2 * block * bytesPerSample) + headerLength;
					for (var i = 0; i < bytesPerSample; i++) {
						writeView.setUint8(pout++, readView.getUint8(pin++));
					}
				}
				resolve(writeView.buffer);
			};
			worker(0, 10000);
		}
		blobReader.readAsArrayBuffer(blob);
	});

}
