<script>
    import {BrowserCodeReader, BrowserQRCodeReader, BrowserQRCodeSvgWriter} from "@zxing/browser";

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

    async function step_1_initiator_create_offer() {
        step1Busy = true;
        channel = connection.createDataChannel('data');
        channel.onmessage = (event) => alert(event.data);

        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                const writer = new BrowserQRCodeSvgWriter();
                qrCode1.appendChild(writer.write(JSON.stringify(connection.localDescription), 512, 512));
                step1Busy = false;
            }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
    }

    async function step_2_accept_remote_offer() {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

        const selectedDeviceId = videoInputDevices[0].deviceId;

        console.log(`Started decode from camera with id ${selectedDeviceId}`);

        const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoPreview1, async (result, error, controls) => {
            await connection.setRemoteDescription(JSON.parse(result.getText()));
            controls.stop();
        });

    }

    async function step_3_create_answer() {
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
                {#if step1Busy}
                    <h3>Generating...</h3>
                {:else}
                    <button on:click={step_1_initiator_create_offer}>create offer</button>
                {/if}
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
                {#if step3Busy}
                    <h3>Generating...</h3>
                {:else}
                    <button on:click={step_3_create_answer}>create answer</button>
                {/if}
                <div bind:this={qrCode2}></div>
            </td>
        </tr>
        <tr>
            <td>step 4</td>
            <td>
                <button on:click={step_4_accept_answer}>scan answer QR code</button>
                <video bind:this={videoPreview2}></video>
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
