//index.js
const io = require('socket.io-client')
const mediasoupClient = require('mediasoup-client')

//const roomName = window.location.pathname.split('/')[2]
const roomName = 'abc'

//const socket = io("ws://hubs.local:3000/mediasoup")
const socket = io("wss://stream.meta-world.gudrb33333.click/mediasoup")

socket.on('connection-success', ({ socketId }) => {
  console.log(socketId)
  getLocalAudioStream()
})

let device
let rtpCapabilities
let producerTransport
let consumerTransports = []
let micProducer
let webcamProducer
let shareProducer
let consumer
let isProducer = false

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce


let micDefaultParams;
let webcamDefalutParams = {
  // mediasoup params
  encodings: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000
  }
};
let consumingTransports = [];

const audioStreamSuccess = (stream) => {
  localAudio.srcObject = stream

  micParams = { track: stream.getAudioTracks()[0], ...micDefaultParams };
  //webcamParams = { track: stream.getVideoTracks()[0], ...webcamDefalutParams };

  joinRoom()
}

const joinRoom = () => {
  socket.emit('joinRoom', { roomName }, (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    // we assign to local variable and will be used when
    // loading the client Device (see createDevice above)
    rtpCapabilities = data.rtpCapabilities

    // once we have rtpCapabilities from the Router, create Device
    createDevice()
  })
}

const getLocalAudioStream = () => {
  navigator.mediaDevices.getUserMedia({
    audio: true,
    // video: {
    //   width: {
    //     min: 640,
    //     max: 1920,
    //   },
    //   height: {
    //     min: 400,
    //     max: 1080,
    //   }
    // }
  })
  .then(audioStreamSuccess)
  .catch(error => {
    console.log(error.message)
  })
}

// A device is an endpoint connecting to a Router on the
// server side to send/recive media
const createDevice = async () => {
  try {
    device = new mediasoupClient.Device()

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
    // Loads the device with RTP capabilities of the Router (server side)
    await device.load({
      // see getRtpCapabilities() below
      routerRtpCapabilities: rtpCapabilities
    })

    console.log('Device RTP Capabilities', device.rtpCapabilities)

    // once the device loads, create transport
    createSendTransport()

  } catch (error) {
    console.log(error)
    if (error.name === 'UnsupportedError')
      console.warn('browser not supported')
  }
}

const createSendTransport = () => {
  // see server's socket.on('createWebRtcTransport', sender?, ...)
  // this is a call from Producer, so sender = true
  socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
    // The server sends back params needed 
    // to create Send Transport on the client side
    if (params.error) {
      console.log(params.error)
      return
    }

    console.log(params)

    // creates a new WebRTC Transport to send media
    // based on the server's producer transport params
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
    producerTransport = device.createSendTransport(params)

    // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
    // this event is raised when a first call to transport.produce() is made
    // see connectSendTransport() below
    producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        // Signal local DTLS parameters to the server side transport
        // see server's socket.on('transport-connect', ...)
        await socket.emit('transport-connect', {
          dtlsParameters,
        })

        // Tell the transport that parameters were transmitted.
        callback()

      } catch (error) {
        errback(error)
      }
    })

    producerTransport.on('produce', async (parameters, callback, errback) => {
      console.log(parameters)

      try {
        // tell the server to create a Producer
        // with the following parameters and produce
        // and expect back a server side producer id
        // see server's socket.on('transport-produce', ...)
        await socket.emit('transport-produce', {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        }, ({ id, producersExist }) => {
          // Tell the transport that parameters were transmitted and provide it with the
          // server side producer's id.
          callback({ id })

          // if producers exist, then join room
          if (producersExist) getProducers()
        })
      } catch (error) {
        errback(error)
      }
    })

    //connectSendTransport
    enableMic()
  })
}

const connectSendTransport = async () => {
  // we now call produce() to instruct the producer transport
  // to send media to the Router
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  // this action will trigger the 'connect' and 'produce' events above
  
  micProducer = await producerTransport.produce(micParams);
  webcamProducer = await producerTransport.produce(webcamParams);

  micProducer.on('trackended', () => {
    console.log('audio track ended')

    // close audio track
  })

  micProducer.on('transportclose', () => {
    console.log('audio transport ended')

    // close audio track
  })
  
  webcamProducer.on('trackended', () => {
    console.log('video track ended')

    // close video track
  })

  webcamProducer.on('transportclose', () => {
    console.log('video transport ended')

    // close video track
  })
}

const signalNewConsumerTransport = async (remoteProducerId) => {
  //check if we are already consuming the remoteProducerId
  if (consumingTransports.includes(remoteProducerId)) return;
  consumingTransports.push(remoteProducerId);

  await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
    // The server sends back params needed 
    // to create Send Transport on the client side
    if (params.error) {
      console.log(params.error)
      return
    }
    console.log(`PARAMS... ${params}`)

    let consumerTransport
    try {
      consumerTransport = device.createRecvTransport(params)
    } catch (error) {
      // exceptions: 
      // {InvalidStateError} if not loaded
      // {TypeError} if wrong arguments.
      console.log(error)
      return
    }

    consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        // Signal local DTLS parameters to the server side transport
        // see server's socket.on('transport-recv-connect', ...)
        await socket.emit('transport-recv-connect', {
          dtlsParameters,
          serverConsumerTransportId: params.id,
        })

        // Tell the transport that parameters were transmitted.
        callback()
      } catch (error) {
        // Tell the transport that something was wrong
        errback(error)
      }
    })

    connectRecvTransport(consumerTransport, remoteProducerId, params.id)
  })
}

// server informs the client of a new producer just joined
socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

const getProducers = () => {
  socket.emit('getProducers', producerIds => {
    console.log(producerIds)
    // for each of the producer create a consumer
    // producerIds.forEach(id => signalNewConsumerTransport(id))
    producerIds.forEach(signalNewConsumerTransport)
  })
}

const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
  // for consumer, we need to tell the server first
  // to create a consumer based on the rtpCapabilities and consume
  // if the router can consume, it will send back a set of params as below
  await socket.emit('consume', {
    rtpCapabilities: device.rtpCapabilities,
    remoteProducerId,
    serverConsumerTransportId,
  }, async ({ params }) => {
    if (params.error) {
      console.log('Cannot Consume')
      return
    }

    console.log(`Consumer Params ${params}`)
    // then consume with the local consumer transport
    // which creates a consumer
    const consumer = await consumerTransport.consume({
      id: params.id,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters
    })

    consumerTransports = [
      ...consumerTransports,
      {
        consumerTransport,
        serverConsumerTransportId: params.id,
        producerId: remoteProducerId,
        consumer,
      },
    ]

    // create a new div element for the new consumer media
    const newElem = document.createElement('div')
    newElem.setAttribute('id', `td-${remoteProducerId}`)

    if (params.kind == 'audio') {
      //append to the audio container
      newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
    } else {
      //append to the video container
      newElem.setAttribute('class', 'remoteVideo')
      newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video" ></video>'
    }

    videoContainer.appendChild(newElem)

    // destructure and retrieve the video track from the producer
    const { track } = consumer

    document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

    // the server consumer started with media paused
    // so we need to inform the server to resume
    socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId })
  })
}

socket.on('producer-closed', ({ remoteProducerId }) => {
  // server notification is received when a producer is closed
  // we need to close the client-side consumer and associated transport
  const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
  producerToClose.consumerTransport.close()
  producerToClose.consumer.close()

  // remove the consumer transport from the list
  consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

  // remove the video div element
  videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})

const enableMic = async () => {
  // we now call produce() to instruct the producer transport
  // to send media to the Router
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  // this action will trigger the 'connect' and 'produce' events above
  
  if (micProducer)
  return;

  micProducer = await producerTransport.produce(micParams);

  micProducer.on('trackended', () => {
    console.log('audio track ended')

    // close audio track
  })

  micProducer.on('transportclose', () => {
    console.log('audio transport ended')

    // close audio track
  })
}

const muteMic = async () => {
  console.log('muteMic()');
  micProducer.pause();
  try {
      await socket.emit('pauseProducer', { producerId: micProducer.id });
      //store.dispatch(stateActions.setProducerPaused(this._micProducer.id));
  }
  catch (error) {
      logger.error('muteMic() | failed: %o', error);
  }
}

const unmuteMic = async () => {
  console.log('unmuteMic()');
  micProducer.resume();
  try {
      //await this._protoo.request('resumeProducer', { producerId: this._micProducer.id });
      await socket.emit('resumeProducer', { producerId: micProducer.id });
      //store.dispatch(stateActions.setProducerResumed(this._micProducer.id));
  }
  catch (error) {
      logger.error('unmuteMic() | failed: %o', error);
  }
}

const disableMic = async () => {
  console.log('disableMic()');
  console.log(micProducer.id);
  //await socket.emit('closeProducer', { producerId: micProducer.id })

  // if (!micProducer)
  //     return;
  // micProducer.close();
  // try {
  //   await socket.emit('closeProducer', { producerId: micProducer,id })
  // }
  // catch (error) {
  //     logger.error(`Error closing server-side mic Producer: ${error}`);
  // }
  // micProducer = null;
}

const enableWebcam = async () => {
  console.log('enableWebcam()')
  if (webcamProducer)
      return;
  // if (!this._mediasoupDevice.canProduce('video')) {
  //     logger.error('enableWebcam() | cannot produce video');
  //     return;
  // }
  // store.dispatch(stateActions.setWebcamInProgress(true));
  //let stream;
  try {

    stream = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        }
      }
    }).then(async (stream) =>{
      localWebcam.srcObject = stream
      webcamParams = { track: stream.getVideoTracks()[0], ...webcamDefalutParams }

      webcamProducer = await producerTransport.produce(webcamParams);

      webcamProducer.on('transportclose', () => {
        webcamProducer = null;
      });
      webcamProducer.on('trackended', () => {
        console.log('Webcam disconnected!');
        disableWebcam()
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            .catch(() => { });
      });
    })
    .catch(error => {
      console.log(error.message)
    })


    // if (!this._externalVideo) {
    //     stream = await this._worker.getUserMedia({
    //         video: { source: 'device' }
    //     });
    // }
    // else {
    //     stream = await this._worker.getUserMedia({
    //         video: {
    //             source: this._externalVideo.startsWith('http') ? 'url' : 'file',
    //             file: this._externalVideo,
    //             url: this._externalVideo
    //         }
    //     });
    // }
    // TODO: For testing.
    //global.videoStream = stream;

    //webcamProducer = await producerTransport.produce(webcamParams);
    // TODO.
    // const device = {
    //     label: 'rear-xyz'
    // };
    // store.dispatch(stateActions.addProducer({
    //     id: this._webcamProducer.id,
    //     deviceLabel: device.label,
    //     type: this._getWebcamType(device),
    //     paused: this._webcamProducer.paused,
    //     track: this._webcamProducer.track,
    //     rtpParameters: this._webcamProducer.rtpParameters,
    //     codec: this._webcamProducer.rtpParameters.codecs[0].mimeType.split('/')[1]
    // }));
    //webcamProducer.on('transportclose', () => {
    //    webcamProducer = null;
    //});
    //webcamProducer.on('trackended', () => {
    //    console.log('Webcam disconnected!');
        // this.disableWebcam()
        //     // eslint-disable-next-line @typescript-eslint/no-empty-function
        //     .catch(() => { });
    //});
  }
  catch (error) {
      console.error('enableWebcam() | failed:%o', error);
      console.error('enabling Webcam!');
      // if (track)
      //     track.stop();
  }
  //store.dispatch(stateActions.setWebcamInProgress(false));
}

const disableWebcam = async () => {
  console.log('disableWebcam()');
  if (!webcamProducer)
      return;
  webcamProducer.close();
  //store.dispatch(stateActions.removeProducer(this._webcamProducer.id));
  try {
    await socket.emit('closeProducer', { producerId: webcamProducer.id });
  }
  catch (error) {
      console.error(`Error closing server-side webcam Producer: ${error}`);
  }
  webcamProducer = null;
}


const enableShare = async () => {
  console.log('enableShare()')
  if (webcamProducer)
      return;
  // if (!this._mediasoupDevice.canProduce('video')) {
  //     logger.error('enableWebcam() | cannot produce video');
  //     return;
  // }
  // store.dispatch(stateActions.setWebcamInProgress(true));
  //let stream;
  try {

    stream = navigator.mediaDevices.getDisplayMedia({
      audio : false,
      video :
      {
        displaySurface : 'monitor',
        logicalSurface : true,
        cursor         : true,
        width          : { max: 1920 },
        height         : { max: 1080 },
        frameRate      : { max: 30 }
      }
    }).then(async (stream) =>{
      localShare.srcObject = stream
      shareParams = { track: stream.getVideoTracks()[0], ...webcamDefalutParams }

      shareProducer = await producerTransport.produce(shareParams);

      shareProducer.on('transportclose', () => {
        shareProducer = null;
      });
      shareProducer.on('trackended', () => {
        console.log('Webcam disconnected!');
        disableShare()
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            .catch(() => { });
      });
    })
    .catch(error => {
      console.log(error.message)
    })


    // if (!this._externalVideo) {
    //     stream = await this._worker.getUserMedia({
    //         video: { source: 'device' }
    //     });
    // }
    // else {
    //     stream = await this._worker.getUserMedia({
    //         video: {
    //             source: this._externalVideo.startsWith('http') ? 'url' : 'file',
    //             file: this._externalVideo,
    //             url: this._externalVideo
    //         }
    //     });
    // }
    // TODO: For testing.
    //global.videoStream = stream;

    //webcamProducer = await producerTransport.produce(webcamParams);
    // TODO.
    // const device = {
    //     label: 'rear-xyz'
    // };
    // store.dispatch(stateActions.addProducer({
    //     id: this._webcamProducer.id,
    //     deviceLabel: device.label,
    //     type: this._getWebcamType(device),
    //     paused: this._webcamProducer.paused,
    //     track: this._webcamProducer.track,
    //     rtpParameters: this._webcamProducer.rtpParameters,
    //     codec: this._webcamProducer.rtpParameters.codecs[0].mimeType.split('/')[1]
    // }));
    //webcamProducer.on('transportclose', () => {
    //    webcamProducer = null;
    //});
    //webcamProducer.on('trackended', () => {
    //    console.log('Webcam disconnected!');
        // this.disableWebcam()
        //     // eslint-disable-next-line @typescript-eslint/no-empty-function
        //     .catch(() => { });
    //});
  }
  catch (error) {
      console.error('enableWebcam() | failed:%o', error);
      console.error('enabling Webcam!');
      // if (track)
      //     track.stop();
  }
  //store.dispatch(stateActions.setWebcamInProgress(false));
}

const disableShare= async () => {
  console.log('disableWebcam()');
  if (!shareProducer)
      return;
  shareProducer.close();
  //store.dispatch(stateActions.removeProducer(this._webcamProducer.id));
  try {
    await socket.emit('closeProducer', { producerId: shareProducer.id });
  }
  catch (error) {
      console.error(`Error closing server-side webcam Producer: ${error}`);
  }
  shareProducer = null;
}


btnEnableMic.addEventListener('click',enableMic)
btnDisableMic.addEventListener('click',disableMic)
btnMuteMic.addEventListener('click',muteMic)
btnUnmuteMic.addEventListener('click',unmuteMic)
btnEnableWebcam.addEventListener('click',enableWebcam)
btnDisableWebcam.addEventListener('click',disableWebcam)
btnEnableShare.addEventListener('click',enableShare)
btnDisableShare.addEventListener('click',disableShare)