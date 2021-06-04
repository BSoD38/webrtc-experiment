<script>
    import {BrowserCodeReader, BrowserQRCodeReader, BrowserQRCodeSvgWriter} from "@zxing/browser";
    import QRCode from "easyqrcodejs";

    const FILE_CHUNK_SIZE = 65536; //64KiB

    let isHost = false;
    let channel = null;
    let qrCode1;
    let qrCode2;
    let connectionState;
    let iceConnectionState;
    let videoPreview1;
    let videoPreview2;
    let step1Busy = false;
    let step3Busy = false;
    let qrCodeState1 = "";
    let qrCodeState2 = "";
    let files;
    let imageBlobs = [];
    let fileChunks = new ArrayBuffer(0);
    let transmittingFile = false;
    let transmittedFileInfo = {};
    let transmissionTimeout;
    let debug = "";
    let currentChunk = 0;

    const connection = new RTCPeerConnection({
        iceServers: [],
    });

    const onDataReceived = ({data}) => {
        if (typeof data === "string") {
            if (data === "EOT") {
                clearTimeout(transmissionTimeout);
                transmittingFile = false;
                if (fileChunks.byteLength !== transmittedFileInfo.size) {
                    throw new Error(`Transmission failed. Expected size is ${transmittedFileInfo.size} bytes, but the received stream is ${fileChunks.byteLength} bytes.`);
                }
                imageBlobs.push(new Blob([fileChunks], {type: transmittedFileInfo.type}));
                console.log(imageBlobs);
                fileChunks = new ArrayBuffer(0);
            } else {
                transmittedFileInfo = JSON.parse(data);
                transmittingFile = true;
            }
        }
        if (data instanceof ArrayBuffer && transmittingFile) {
            clearTimeout(transmissionTimeout);
            // Concatenate the file chunk to the array buffer.
            const appendedChunks = new Uint8Array(fileChunks.byteLength + data.byteLength);
            appendedChunks.set(fileChunks, 0);
            appendedChunks.set(data, fileChunks.byteLength);
            fileChunks = appendedChunks.buffer;
            transmissionTimeout = setTimeout(() => {onDataReceived({data: "EOT"})}, 5000);
        }
    }

    function splitFileChunks(buffer) {
        if (!buffer instanceof ArrayBuffer) {
            return;
        }
        const chunkArray = [];
        let byteOffset = 0;
        while (byteOffset < buffer.byteLength) {
            chunkArray.push(buffer.slice(byteOffset, byteOffset + FILE_CHUNK_SIZE));
            byteOffset += FILE_CHUNK_SIZE;
        }
        return chunkArray;
    }

    connection.ondatachannel = (e) => {
        console.log('ondatachannel');
        channel = e.channel;
        channel.onmessage = onDataReceived;
        channel.bufferedAmountLowThreshold = 8192; //64KiB
    };

    connection.onconnectionstatechange = () => {
        connectionState = connection.connectionState;
    };
    connection.oniceconnectionstatechange = () => {
        iceConnectionState = connection.iceConnectionState;
        if (connection.iceConnectionState === "checking" && isHost === true) {
            finalStepAcceptAnswer();
        }
    };

    async function firstStepCreateOffer() {
        isHost = true;
        step1Busy = true;
        channel = connection.createDataChannel('data');
        channel.onmessage = onDataReceived;
        channel.bufferedAmountLowThreshold = 8192; //64KiB

        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                const orig = JSON.stringify(connection.localDescription);
                new QRCode(qrCode1, {text: orig, height: 500, width: 500, correctLevel: QRCode.CorrectLevel.L});
                step1Busy = false;
            }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
    }

    async function secondStepAcceptOffer() {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

        const selectedDeviceId = videoInputDevices[0].deviceId;

        console.log(`Started decode from camera with id ${selectedDeviceId}`);

        qrCodeState1 = "Reading...";
        const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoPreview1, async (result, error) => {
            if (result) {
                controls.stop();
                qrCodeState1 = "OK!";
                await connection.setRemoteDescription(JSON.parse(result.getText()));
                await thirdStepCreateAnswer();
            }
            if (error) {
                qrCodeState1 = `${error.name} ${error.getKind()} ${error.message}`;
            }
        });

    }

    async function thirdStepCreateAnswer() {
        step3Busy = true;
        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                const orig = JSON.stringify(connection.localDescription);
                new QRCode(qrCode2, {text: orig, height: 500, width: 500, correctLevel: QRCode.CorrectLevel.L});
                step3Busy = false;
            }
        };

        try {
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
        } catch (error) {
            console.error(error);
        }
    }

    async function finalStepAcceptAnswer() {
        const codeReader = new BrowserQRCodeReader();
        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

        const selectedDeviceId = videoInputDevices[0].deviceId;

        console.log(`Started decode from camera with id ${selectedDeviceId}`);

        qrCodeState2 = "Reading...";
        const controls = await codeReader.decodeFromVideoDevice(selectedDeviceId, videoPreview2, async (result, error) => {
            if (result) {
                controls.stop();
                qrCodeState2 = "OK!";
                await connection.setRemoteDescription(JSON.parse(result.getText()));
            }
            if (error) {
                qrCodeState2 = `${error.name} ${error.getKind()} ${error.message}`;
            }
        });
    }

    async function sendFile() {
        const file = files[0];
        if (file.size > 50*1024*1024) {
            throw new Error("The file is over 50MB");
        }
        // The first data transmission contains info about the file to transfer
        channel.send(JSON.stringify({name: file.name, type: file.type, size: file.size}));
        // The file is then split into 16KiB ArrayBuffer chunks
        const chunks = splitFileChunks(await file.arrayBuffer());

        channel.onbufferedamountlow = () => {
            console.log(currentChunk);
            channel.send(chunks[currentChunk]);
            currentChunk++;
            debug = `Transmitted ${(currentChunk/chunks.length)*100}% of file.`;
            if (currentChunk >= chunks.length) {
                console.log("end");
                channel.onbufferedamountlow = undefined;
                // Sends an End-Of-Transfer flag to mark the end of the transmission.
                channel.send("EOT");
                debug += "\nSent EOT.";
                currentChunk = 0;
            }
        }
        currentChunk++;
        channel.send(chunks[0]);
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
            <td>step 2 and 3</td>
            <td></td>
            <td>
                <button on:click={secondStepAcceptOffer}>scan offer QR code</button>
                <video bind:this={videoPreview1}></video>
                {qrCodeState1}
                {#if step3Busy}
                    <h3>Generating...</h3>
                {/if}
                <div bind:this={qrCode2}></div>
            </td>
        </tr>
        <tr>
            <td>step 4</td>
            <td>
                <video bind:this={videoPreview2}></video>
                {qrCodeState2}
            </td>
            <td></td>
        </tr>
    </table>
    <hr/>
    <input bind:files accept="image/jpeg, image/webp" type="file"/>
    <button on:click={sendFile}>Send</button>
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
    <code>
        {debug}
    </code>
    <div>
        {#each imageBlobs as image}
            <img src={URL.createObjectURL(image)} alt="image"/>
        {/each}
    </div>
</main>

<style>
    code {
        display: block;
        white-space: pre-wrap;
        font-family: monospace;
    }
</style>
