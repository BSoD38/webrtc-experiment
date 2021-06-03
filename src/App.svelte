<script>
    import {BrowserCodeReader, BrowserQRCodeReader, BrowserQRCodeSvgWriter} from "@zxing/browser";

    let channel = null;
    let qrCode1;
    let qrCode2;
    let connectionState;
    let iceConnectionState;
    let videoPreview1;
    let videoPreview2;

    const connection = new RTCPeerConnection({
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
    });

    connection.ondatachannel = (e) => {
        console.log('ondatachannel');
        channel = e.channel;
        // channel.onopen = event => console.log('onopen', event);
        // channel.onmessage = event => console.log('onmessage', event);
        channel.onmessage = (event) => alert(event.data);
    };

    connection.onconnectionstatechange = () => {
        connectionState = connection.connectionState;
        // console.log('onconnectionstatechange', connection.connectionState)
    };
    connection.oniceconnectionstatechange = () => {
        iceConnectionState = connection.iceConnectionState;
        // console.log('oniceconnectionstatechange', connection.iceConnectionState)
    };

    async function step_1_initiator_create_offer() {
        channel = connection.createDataChannel('data');
        // channel.onopen = event => console.log('onopen', event)
        // channel.onmessage = event => console.log('onmessage', event)
        channel.onmessage = (event) => alert(event.data);

        connection.onicecandidate = (event) => {
            // console.log('onicecandidate', event)
            if (!event.candidate) {
                const writer = new BrowserQRCodeSvgWriter();
                // const data = compress(connection.localDescription, {outputEncoding: "BinaryString"});
                // console.log(data);
                qrCode1.appendChild(writer.write(JSON.stringify(connection.localDescription), 512, 512));
            }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
    }

    async function step_2_accept_remote_offer() {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

        // choose your media device (webcam, frontal camera, back camera, etc.)
        const selectedDeviceId = videoInputDevices[0].deviceId;

        console.log(`Started decode from camera with id ${selectedDeviceId}`);

        // you can use the controls to stop() the scan or switchTorch() if available
        const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoPreview1, async (result, error, controls) => {
            // use the result and error values to choose your actions
            // you can also use controls API in this scope like the controls
            // returned from the method.
            await connection.setRemoteDescription(JSON.parse(result.getText()));
            controls.stop();
        });

    }

    async function step_3_create_answer() {
        connection.onicecandidate = (event) => {
            // console.log('onicecandidate', event)
            if (!event.candidate) {
                document.getElementById('createdAnswer').value = JSON.stringify(connection.localDescription);
                document.getElementById('createdAnswer').hidden = false;
            }
        };

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
    }

    async function step_4_accept_answer() {
        const answer = JSON.parse(document.getElementById('remoteAnswer').value);
        await connection.setRemoteDescription(answer);
    }

    async function send_text() {
        const text = document.getElementById('text').value;

        channel.send(text);
    }

</script>

<main>
    <table border="1" width="100%">
        <tr>
            <th>#</th>
            <th>initiator</th>
            <th>peer</th>
        </tr>
        <tr>
            <td>step 1</td>
            <td>
                <button on:click={step_1_initiator_create_offer}>create offer</button>
                <div bind:this={qrCode1}></div>
            </td>
            <td></td>
        </tr>
        <tr>
            <td>step 2</td>
            <td></td>
            <td>
                <button on:click={step_2_accept_remote_offer}>scan offer QR code</button>
                <video bind:this={videoPreview1}></video>
            </td>
        </tr>
        <tr>
            <td>step 3</td>
            <td></td>
            <td>
                <input on:click={step_3_create_answer} type="button" value="create answer"/>
                <div bind:this={qrCode2}></div>
            </td>
        </tr>
        <tr>
            <td>step 4</td>
            <td>
                <input id="remoteAnswer" placeholder="answer from peer" type="text"/>
                <input on:click={step_4_accept_answer} type="button" value="accept answer"/>
            </td>
            <td></td>
        </tr>
    </table>
    <hr/>
    <input id="text" type="text"/>
    <input onclick="send_text()" type="button" value="send"/>
    <hr/>
    <table border="1">
        <tr>
            <th colspan="2">connection</th>
        </tr>
        <tr>
            <th>connectionState</th>
            <td id="connectionState">{connectionState}</td>
        </tr>
        <tr>
            <th>iceConnectionState</th>
            <td id="iceConnectionState">{iceConnectionState}</td>
        </tr>
    </table>
</main>

<style>
</style>
