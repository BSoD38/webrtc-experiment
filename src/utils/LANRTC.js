import {buf} from "crc-32";
import {appendChunk, splitFileChunks} from "./fileOperations";

const BUFFER_THRESHOLD = 8192; // 8KiB

export default class LANRTC {
    connectionState;
    iceConnectionState;
    channel = null;
    connection = null;
    transmissionFinishedCallback = null;
    receivedChunkCallback = null;
    isHost = false;
    ready = false;
    isTransmittingFile = false;
    transmittedFileInfo;
    transmissionTimeout;
    fileChunks = new Uint8Array(0);

    constructor(answerAcceptedCallback, peerConnectedCallback, transmissionFinishedCallback = () => {}, receivedChunkCallback = () => {}) {
        this.transmissionFinishedCallback = transmissionFinishedCallback;
        this.receivedChunkCallback = receivedChunkCallback;
        // This configuration is used to be able to use WebRTC in a local network
        this.connection = new RTCPeerConnection({
            iceServers: [],
        });

        this.connection.onconnectionstatechange = () => {
            this.connectionState = this.connection.connectionState;
            if (this.connection.connectionState === "connected") {
                peerConnectedCallback();
            }
        };

        this.connection.oniceconnectionstatechange = () => {
            this.iceConnectionState = this.connection.iceConnectionState;
            if (this.connection.iceConnectionState === "checking" && this.isHost === true) {
                answerAcceptedCallback();
            }
        };

        this.connection.ondatachannel = (e) => {
            console.log('ondatachannel');
            this.channel = e.channel;
            this.channel.onmessage = event => {this.onDataReceived(event)};
            this.channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD; //8KiB
        };
    }

    async createOffer(iceCandidateCallback) {
        this.isHost = true;
        this.channel = this.connection.createDataChannel('data');
        this.channel.onmessage = event => {this.onDataReceived(event)};
        this.channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD; //8KiB
        this.connection.onicecandidate = iceCandidateCallback;
        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);
    }

    async createAnswer(iceCandidateCallback) {
        this.connection.onicecandidate = iceCandidateCallback;
        await this.connection.setLocalDescription(await this.connection.createAnswer());
    }

    acceptDescription(description) {
        return this.connection.setRemoteDescription(description);
    }

    getLocalDescription() {
        return this.connection.localDescription;
    }

    async sendFile(files, chunkSentCallback, transmissionFinishedCallback) {
        if (this.isTransmittingFile) {
            throw new Error("File transmission already in progress. Wait for the current one to finish before starting another one.");
        }
        const file = files[0];
        if (file.size > 200*1024*1024) {
            throw new Error("The file is over 200MB");
        }
        const buffer = new Uint8Array(await file.arrayBuffer());
        // The first data transmission contains the file's metadata
        this.channel.send(JSON.stringify({name: file.name, type: file.type, size: file.size, crc32: buf(buffer)}));
        // The file is split into 64KiB ArrayBuffer chunks
        const chunks = splitFileChunks(buffer);

        if (chunks.length === 1) {
            this.channel.send(chunks[0]);
            this.channel.send("EOT");
            return;
        }
        let transmissionProgress = {totalBytes: file.size.toFixed(0), transmittedBytes: 0, progress: "0"};
        let currentChunk = 1;
        this.channel.onbufferedamountlow = () => {
            this.channel.send(chunks[currentChunk]);
            transmissionProgress.transmittedBytes = currentChunk * 65536;
            transmissionProgress.progress = ((transmissionProgress.transmittedBytes / transmissionProgress.totalBytes) * 100).toFixed(2);
            if (typeof chunkSentCallback === "function") {
                chunkSentCallback(transmissionProgress);
            }
            currentChunk++;
            if (currentChunk >= chunks.length) {
                this.channel.onbufferedamountlow = undefined;
                // Sends an End-Of-Transfer flag to mark the end of the transmission.
                this.channel.send("EOT");
                currentChunk = 0;
                transmissionFinishedCallback();
            }
        }
        this.channel.send(chunks[0]);
        return transmissionProgress;
    }
    
    onDataReceived({data}) {
        // String data either means it contains metadata about the file or is an EOT
        if (typeof data === "string") {
            // EOT stands for "End Of Transmission"
            if (data === "EOT") {
                clearTimeout(this.transmissionTimeout);
                this.isTransmittingFile = false;
                if (this.fileChunks.byteLength !== this.transmittedFileInfo.size) {
                    throw new Error(`Transmission failed. Expected size is ${this.transmittedFileInfo.size} bytes, but the received stream is ${this.fileChunks.byteLength} bytes.`);
                }
                const receivedCRC32 = buf(this.fileChunks);
                if (receivedCRC32 !== this.transmittedFileInfo.crc32) {
                    throw new Error(`File has been corrupted. Expected hash is ${this.transmittedFileInfo.crc32}, but the received buffer hash is ${receivedCRC32}.`);
                }
                const blob = new Blob([this.fileChunks], {type: this.transmittedFileInfo.type});
                if (typeof this.transmissionFinishedCallback === "function") {
                    this.transmissionFinishedCallback(blob, this.transmittedFileInfo);
                }
                this.transmittedFileInfo = undefined;
                this.fileChunks = new Uint8Array(0);
            } else {
                // First transmission should be a string JSON containing the file's metadata
                this.transmittedFileInfo = JSON.parse(data);
                this.isTransmittingFile = true;
            }
        }
        if (data instanceof ArrayBuffer && this.isTransmittingFile) {
            clearTimeout(this.transmissionTimeout);
            // Concatenate the file chunk to the array buffer.
            this.fileChunks = appendChunk(new Uint8Array(this.fileChunks), new Uint8Array(data));
            if (typeof this.receivedChunkCallback === "function") {
                this.receivedChunkCallback(this.fileChunks, this.transmittedFileInfo);
            }
            this.transmissionTimeout = setTimeout(() => {this.onDataReceived({data: "EOT"})}, 5000);
        }
    }
}
