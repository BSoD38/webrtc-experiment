<script>
    import jsQR from "jsqr";
    import QRCode from "easyqrcodejs";
    import {buf} from "crc-32";

    const FILE_CHUNK_SIZE = 65536; //64KiB

    let isHost = false;
    let channel = null;
    let qrCode1;
    let qrCode2;
    let connectionState;
    let iceConnectionState;
    let canvasPreview1;
    let video1;
    let canvasPreview2;
    let video2;
    let step1Busy = false;
    let step3Busy = false;
    let qrCodeState1 = "";
    let qrCodeState2 = "";
    let files;
    let imageBlobs = [];
    let fileChunks = new Uint8Array(0);
    let transmittingFile = false;
    let transmittedFileInfo = {};
    let transmissionTimeout;
    let debug = "";
    let currentChunk = 0;
    let currentStep = 0;
    let ready = false;
    let stream = null;

    // This setup is used to work within a LAN without internet access.
    const connection = new RTCPeerConnection({
        iceServers: [],
    });

    connection.onconnectionstatechange = () => {
        connectionState = connection.connectionState;
        if (connection.connectionState === "connected") {
            ready = true;
        }
    };

    connection.oniceconnectionstatechange = () => {
        iceConnectionState = connection.iceConnectionState;
        if (connection.iceConnectionState === "checking" && isHost === true) {
            finalStepAcceptAnswer();
        }
    };

    connection.ondatachannel = (e) => {
        console.log('ondatachannel');
        channel = e.channel;
        channel.onmessage = onDataReceived;
        channel.bufferedAmountLowThreshold = 8192; //8KiB
    };

    const onDataReceived = ({data}) => {
        // String data either means
        if (typeof data === "string") {
            if (data === "EOT") {
                clearTimeout(transmissionTimeout);
                transmittingFile = false;
                if (fileChunks.byteLength !== transmittedFileInfo.size) {
                    throw new Error(`Transmission failed. Expected size is ${transmittedFileInfo.size} bytes, but the received stream is ${fileChunks.byteLength} bytes.`);
                }
                const receivedCRC32 = buf(fileChunks);
                if (receivedCRC32 !== transmittedFileInfo.crc32) {
                    throw new Error(`File has been corrupted. Expected hash is ${transmittedFileInfo.crc32}, but the received buffer hash is ${receivedCRC32}.`);
                }
                const blob = new Blob([fileChunks], {type: transmittedFileInfo.type});
                // Image files are added directly to the DOM. Other files are downloaded onto the computer.
                if (transmittedFileInfo.type.includes("image")) {
                    // The array is reassigned to trigger an update on Svelte.
                    imageBlobs = [...imageBlobs, blob];
                } else {
                    const blobUrl = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = blobUrl;
                    link.download = transmittedFileInfo.name;
                    document.body.appendChild(link);
                    link.dispatchEvent(
                        new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        })
                    );
                    document.body.removeChild(link);
                }
                fileChunks = new Uint8Array(0);
            } else {
                try {
                    transmittedFileInfo = JSON.parse(data);
                    transmittingFile = true;
                } catch (e) {
                    console.error(e);
                    console.log(data);
                    debug = "Oops! Something went wrong with the transmission!";
                }
            }
        }
        if (data instanceof ArrayBuffer && transmittingFile) {
            clearTimeout(transmissionTimeout);
            // Concatenate the file chunk to the array buffer.
            const buffer = new ArrayBuffer(fileChunks.byteLength + data.byteLength);
            const appendedChunks = new Uint8Array(buffer);
            appendedChunks.set(fileChunks);
            appendedChunks.set(new Uint8Array(data), fileChunks.byteLength);
            fileChunks = appendedChunks;
            debug = `Received ${(fileChunks.byteLength/1024).toFixed(0)}/${(transmittedFileInfo.size / 1024).toFixed(0)}KiB. (${((fileChunks.byteLength/transmittedFileInfo.size) * 100).toFixed(2)}%)`;
            transmissionTimeout = setTimeout(() => {onDataReceived({data: "EOT"})}, 5000);
        }
    }

    function startHost() {
        isHost = true;
        currentStep = 1;
    }

    function startPeer() {
        currentStep = 1;
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

    async function handleConnectionQRCode(canvas, video, callback) {
        if (video.paused) {
            video.play();
        }
        if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            requestAnimationFrame(() => {handleConnectionQRCode(canvas, video, callback)});
            return;
        }
        canvas.hidden = false;
        canvas.height = video.videoHeight;
        canvas.width = video.videoWidth;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {inversionAttempts: "dontInvert"});
        if (code) {
            try {
                video.pause();
                for (const track of stream.getTracks()) {
                    track.stop();
                }
                video.remove();
                const json = JSON.parse(code.data);
                await connection.setRemoteDescription(json);
                callback();
            } catch (e) {
                console.error(e);
                requestAnimationFrame(() => {handleConnectionQRCode(canvas, video, callback)});
            }
        } else {
            requestAnimationFrame(() => {handleConnectionQRCode(canvas, video, callback)});
        }
    }

    async function firstStepCreateOffer() {
        currentStep = 2;
        step1Busy = true;
        channel = connection.createDataChannel('data');
        channel.onmessage = onDataReceived;
        channel.bufferedAmountLowThreshold = 8192; //8KiB

        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                new QRCode(qrCode1, {
                    text: JSON.stringify(connection.localDescription),
                    height: 350,
                    width: 350,
                    correctLevel: QRCode.CorrectLevel.L
                });
                step1Busy = false;
            }
        };

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
    }

    async function secondStepAcceptOffer() {
        currentStep = 2;

        qrCodeState1 = "Waiting for camera...";
        video1 = document.createElement("video");
        video1.setAttribute("playsinline", "true");
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
        video1.srcObject = stream;

        requestAnimationFrame(() => {handleConnectionQRCode(canvasPreview1, video1, thirdStepCreateAnswer)});
        qrCodeState1 = "Reading...";
    }

    async function thirdStepCreateAnswer() {
        currentStep = 3;
        step3Busy = true;
        connection.onicecandidate = (event) => {
            if (!event.candidate) {
                new QRCode(qrCode2, {
                    text: JSON.stringify(connection.localDescription),
                    width: 350,
                    height: 350,
                    correctLevel: QRCode.CorrectLevel.L
                });
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
        currentStep = 3;

        qrCodeState2 = "Waiting for camera...";
        video2 = document.createElement("video");
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
        video2.srcObject = stream;
        video2.setAttribute("playsinline", "true");

        requestAnimationFrame(() => {handleConnectionQRCode(canvasPreview2, video2, () => {ready = true;});});
        qrCodeState2 = "Reading...";
    }

    async function sendFile() {
        const file = files[0];
        if (file.size > 200*1024*1024) {
            throw new Error("The file is over 200MB");
        }
        const buffer = new Uint8Array(await file.arrayBuffer());
        // The first data transmission contains info about the file to transfer
        channel.send(JSON.stringify({name: file.name, type: file.type, size: file.size, crc32: buf(buffer)}));
        // The file is then split into 64KiB ArrayBuffer chunks
        const chunks = splitFileChunks(buffer);

        channel.onbufferedamountlow = () => {
            console.log(currentChunk);
            channel.send(chunks[currentChunk]);
            currentChunk++;
            debug = `Transmitted ${((currentChunk/chunks.length)*100).toFixed(2)}% of file.`;
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
    <h2>File transmission system in a LAN without internet</h2>
    {#if currentStep === 0}
        <div>
            <h3>Do you want to host a session or connect to an existing one?</h3>
            <button on:click={startHost}>Host a session</button>
            <button on:click={startPeer}>Connect to host</button>
        </div>
    {/if}
    {#if ready}
        <h3>Awesome! Both devices are now ready to send files to each other.</h3>
        <input bind:files type="file"/>
        <button on:click={sendFile}>Send</button>
        <code>
            {debug}
        </code>
        <div>
            {#each imageBlobs as image}
                <img src={URL.createObjectURL(image)} alt="image"/>
            {/each}
        </div>
    {:else}
        {#if isHost}
            {#if currentStep === 1}
                <h3>First of all, connect both devices to the same local network (such as an access point).</h3>
                <h3>When both devices are ready, click this button.</h3>
                <button on:click={firstStepCreateOffer}>Let's go!</button>
            {:else if currentStep === 2}
                <h3>Now, scan this QR Code with your other device.</h3>
                {#if step1Busy}
                    <h3>Generating QR Code...</h3>
                {/if}
                <div class="qrcode" bind:this={qrCode1}></div>
            {:else if currentStep === 3}
                <h3>Great! Now scan the QR Code generated by the other device.</h3>
                <canvas hidden bind:this={canvasPreview2}></canvas>
                {qrCodeState2}
            {/if}
        {:else}
            {#if currentStep === 1}
                <h3>First of all, connect both devices to the same local network (such as an access point).</h3>
                <h3>When both devices are ready, click this button.</h3>
                <button on:click={secondStepAcceptOffer}>Let's go!</button>
            {:else if currentStep === 2}
                <h3>Now, scan the QR Code generated by the host device.</h3>
                <canvas hidden bind:this={canvasPreview1}></canvas>
                {qrCodeState1}
            {:else if currentStep === 3}
                <h3>Great! Now, scan this QR Code with the host device.</h3>
                {#if step3Busy}
                    <h3>Generating...</h3>
                {/if}
                <div class="qrcode" bind:this={qrCode2}></div>
            {/if}
        {/if}
    {/if}
</main>

<style>
    code {
        display: block;
        white-space: pre-wrap;
        font-family: monospace;
    }

    img {
        display: inline-block;
        max-width: 500px;
        max-height: 500px;
    }

    .qrcode {
        text-align: center;
    }

    .qrcode > * {
        margin: 20px;
    }
</style>
