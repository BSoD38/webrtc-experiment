export function splitFileChunks(buffer, chunkSize = 65536) {
    if (!buffer instanceof ArrayBuffer) {
        throw new Error("Given buffer does not implement ArrayBuffer");
    }
    const chunkArray = [];
    let byteOffset = 0;
    while (byteOffset < buffer.byteLength) {
        chunkArray.push(buffer.slice(byteOffset, byteOffset + chunkSize));
        byteOffset += chunkSize;
    }
    return chunkArray;
}

export function appendChunk(buffer, chunk) {
    if (!(buffer instanceof Uint8Array) || !(chunk instanceof Uint8Array)) {
        throw new Error("Given arguments are not compatible Uint8Arrays.");
    }
    const intBuffer = new Uint8Array(new ArrayBuffer(buffer.byteLength + chunk.byteLength));
    intBuffer.set(buffer);
    intBuffer.set(chunk, buffer.byteLength);
    return intBuffer;
}
