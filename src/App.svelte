<script>
    import {BrowserCodeReader, BrowserQRCodeReader, BrowserQRCodeSvgWriter} from "@zxing/browser";
    import LZString from "lz-string";
    import {compress, decompress} from "lzutf8";

    let channel = null;
    let qrCode1;
    let qrCode2;
    let connectionState;
    let iceConnectionState;
    let videoPreview1;
    let videoPreview2;
    let step1Busy = false;
    let step3Busy = false;

    const connection = new RTCPeerConnection({
        iceServers: [],
    });

    connection.ondatachannel = (e) => {
        console.log('ondatachannel');
        channel = e.channel;
        channel.onmessage = (event) => alert(event.data);
    };

    connection.onconnectionstatechange = () => {
        connectionState = connection.connectionState;
    };
    connection.oniceconnectionstatechange = () => {
        iceConnectionState = connection.iceConnectionState;
    };

    async function firstStepCreateOffer() {
        step1Busy = true;
        channel = connection.createDataChannel('data');
        channel.onmessage = (event) => alert(event.data);

        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                const writer = new BrowserQRCodeSvgWriter();
                const orig = JSON.stringify(connection.localDescription);
                const compressed = compress(orig);
                console.log(orig, orig.length, compressed, compressed.length);
                qrCode1.appendChild(writer.write(orig, 512, 512));
                qrCode1.appendChild(writer.write(compressed, 512, 512));
                step1Busy = false;
            }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
    }

    async function secondStepAcceptOffer() {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

        const selectedDeviceId = videoInputDevices[2].deviceId;

        console.log(`Started decode from camera with id ${selectedDeviceId}`);

        const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoPreview1, async (result, error, controls) => {
            if (result) {
                console.log(result.getBarcodeFormat(), result.getResultPoints());
                // await connection.setRemoteDescription(JSON.parse(result.getText()));
                // controls.stop();
            }
        });

    }

    async function thirdStepCreateAnswer() {
        step3Busy = true;
        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                document.getElementById('createdAnswer').value = JSON.stringify(connection.localDescription);
                document.getElementById('createdAnswer').hidden = false;
                step3Busy = false;
            }
        };

        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
    }

    async function finalStepAcceptAnswer() {
        const answer = JSON.parse(document.getElementById('remoteAnswer').value);
        await connection.setRemoteDescription(answer);
    }

    async function sendText() {
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
                {#if step1Busy}
                    <h3>Generating...</h3>
                {:else}
                    <button on:click={firstStepCreateOffer}>create offer</button>
                {/if}
                <div bind:this={qrCode1}></div>
            </td>
            <td></td>
        </tr>
        <tr>
            <td>step 2</td>
            <td></td>
            <td>
                <button on:click={secondStepAcceptOffer}>scan offer QR code</button>
                <video bind:this={videoPreview1}></video>
            </td>
        </tr>
        <tr>
            <td>step 3</td>
            <td></td>
            <td>
                {#if step3Busy}
                    <h3>Generating...</h3>
                {:else}
                    <button on:click={thirdStepCreateAnswer}>create answer</button>
                {/if}
                <div bind:this={qrCode2}></div>
            </td>
        </tr>
        <tr>
            <td>step 4</td>
            <td>
                <button on:click={finalStepAcceptAnswer}>scan answer QR code</button>
                <video bind:this={videoPreview2}></video>
            </td>
            <td></td>
        </tr>
    </table>
    <hr/>
    <input id="text" type="text"/>
    <input onclick="sendText()" type="button" value="send"/>
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
