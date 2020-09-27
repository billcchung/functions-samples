'use strict';

const functions = require('firebase-functions');
const {Storage} = require('@google-cloud/storage');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// Makes an ffmpeg command return a promise.
function promisifyCommand(command) {
    return new Promise((resolve, reject) => {
        command.on('end', resolve).on('error', reject).run();
    });
}

/**
 * When an audio is uploaded in the Storage bucket We generate a mono channel audio automatically using
 * node-fluent-ffmpeg.
 */
exports.convertWavToAAC = functions.region('asia-east2').storage.bucket("gemmi-songs-wav-prod").object().onFinalize(async (object) => {
    console.log(object);
    console.log(ffmpegInstaller.path, ffmpegInstaller.version);
    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const contentType = object.contentType; // File content type.

    // Exit if this is triggered on a file that is not an audio.
    if (!contentType.startsWith('audio/wav') && !contentType.startsWith('audio/x-wav')) {
        console.log('This is not a wav audio.');
        return null;
    }

    // Get the file name.
    const fileName = path.basename(filePath);

    // Download file from bucket.
    const gcs = new Storage();
    const bucket = gcs.bucket(fileBucket);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const targetTempFileName = fileName.replace(/\.[^/.]+$/, '') + '.aac';
    const targetTempFilePath = path.join(os.tmpdir(), targetTempFileName);
    const targetStorageFilePath = path.join(path.dirname(filePath), targetTempFileName);

    await bucket.file(filePath).download({destination: tempFilePath});
    console.log('Audio downloaded locally to', tempFilePath);
    // Convert the audio to mono channel using FFMPEG.

    let command = ffmpeg(tempFilePath)
        .setFfmpegPath(ffmpegInstaller.path)
        .format('adts')
        .output(targetTempFilePath);

    await promisifyCommand(command);
    console.log('Output audio created at', targetTempFilePath);
    // Uploading the audio.
    const newBucket = gcs.bucket(fileBucket.replace('-wav', ''));
    await newBucket.upload(targetTempFilePath, {destination: targetStorageFilePath, resumable: false});
    console.log('Output audio uploaded to', targetStorageFilePath);

    // Once the audio has been uploaded delete the local file to free up disk space.
    fs.unlinkSync(tempFilePath);
    fs.unlinkSync(targetTempFilePath);

    return console.log('Temporary files removed.', targetTempFilePath);
});

