<script>
    import jsQR from "jsqr";
    import QRCode from "easyqrcodejs";
    import LANRTC from "./utils/LANRTC";

    const lanRTC = new LANRTC(hostAcceptAnswer, () => {lanRTC.ready = true}, onTransmissionFinished, onChunkReceived);
    let qrCode1;
    let qrCode2;
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
    let debug = "";
    let currentStep = 0;
    let stream = null;

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
                const json = JSON.parse(code.data);
                video.pause();
                for (const track of stream.getTracks()) {
                    track.stop();
                }
                video.remove();
                await lanRTC.acceptDescription(json);
                callback();
            } catch (e) {
                console.error(e, code);
                requestAnimationFrame(() => {handleConnectionQRCode(canvas, video, callback)});
            }
        } else {
            requestAnimationFrame(() => {handleConnectionQRCode(canvas, video, callback)});
        }
    }

    async function hostCreateOffer() {
        currentStep = 1;
        step1Busy = true;
        await lanRTC.createOffer((event) => {
            if (!event.candidate) {
                new QRCode(qrCode1, {
                    text: JSON.stringify(lanRTC.getLocalDescription()),
                    height: 350,
                    width: 350,
                    correctLevel: QRCode.CorrectLevel.L
                });
                step1Busy = false;
            }
        });
    }

    async function peerAcceptOffer() {
        currentStep = 1;

        qrCodeState1 = "Waiting for camera...";
        video1 = document.createElement("video");
        video1.setAttribute("playsinline", "true");
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
        video1.srcObject = stream;

        requestAnimationFrame(() => {handleConnectionQRCode(canvasPreview1, video1, peerCreateAnswer)});
        qrCodeState1 = "Reading...";
    }

    async function peerCreateAnswer() {
        currentStep = 2;
        step3Busy = true;
        await lanRTC.createAnswer((event) => {
            if (!event.candidate) {
                new QRCode(qrCode2, {
                    text: JSON.stringify(lanRTC.getLocalDescription()),
                    width: 350,
                    height: 350,
                    correctLevel: QRCode.CorrectLevel.L
                });
                step3Busy = false;
            }
        });
    }

    async function hostAcceptAnswer() {
        currentStep = 2;

        qrCodeState2 = "Waiting for camera...";
        video2 = document.createElement("video");
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
        video2.srcObject = stream;
        video2.setAttribute("playsinline", "true");

        requestAnimationFrame(() => {handleConnectionQRCode(canvasPreview2, video2, () => {lanRTC.ready = true;});});
        qrCodeState2 = "Reading...";
    }

    function onTransmissionFinished(blob, transmittedFileInfo) {
        // Image files are added directly to the DOM. Other files are downloaded onto the computer.
        if (this.transmittedFileInfo.type.includes("image")) {
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
    }

    function onChunkReceived(chunks, transmittedFileInfo) {
        debug = `Received ${(chunks.byteLength/1024).toFixed(0)}/${(transmittedFileInfo.size / 1024).toFixed(0)}KiB. (${((chunks.byteLength/transmittedFileInfo.size) * 100).toFixed(2)}%)`;
    }

    async function sendFile() {
        await lanRTC.sendFile(files, progress => {
            debug = `Transmitted ${progress.transmittedBytes / 1024}/${progress.totalBytes / 1024}KiB (${progress.progress}%) of file.`;
        });
    }

</script>

<svelte:head>
    <title>LANRTC</title>
</svelte:head>
<main>
    <h2>File transmission system in a LAN without internet</h2>
    {#if currentStep === 0}
        <div>
            <h3>
                Before starting, make sure that both devices are connected to the same local network, such as an
                access point (wifi sharing). If they aren't connected before starting, the connection process won't work.
                <br/>
                Please note that a camera is required on both devices as you will need to scan QR Codes.
            </h3>
            <h3>Do you want to host a session or connect to an existing one?</h3>
            <button on:click={hostCreateOffer}>Host a session</button>
            <button on:click={peerAcceptOffer}>Connect to a session</button>
        </div>
    {/if}
    {#if lanRTC?.ready}
        <h3>Awesome! Both devices are now ready to send files to each other.</h3>
        Maximum file size is 200MB.
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
        {#if lanRTC?.isHost}
            {#if currentStep === 1}
                <h3>Now, scan this QR Code with your other device.</h3>
                {#if step1Busy}
                    <h3>Generating QR Code...</h3>
                {/if}
                <div class="qrcode" bind:this={qrCode1}></div>
            {:else if currentStep === 2}
                <h3>Great! Now scan the QR Code generated by the other device.</h3>
                <canvas hidden bind:this={canvasPreview2}></canvas>
                {qrCodeState2}
            {/if}
        {:else}
            {#if currentStep === 1}
                <h3>Now, scan the QR Code generated by the host device.</h3>
                <canvas hidden bind:this={canvasPreview1}></canvas>
                {qrCodeState1}
            {:else if currentStep === 2}
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
