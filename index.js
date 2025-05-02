const express = require('express');
const { ElevenLabsClient } = require('elevenlabs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

const handleTranscriptionRequest = async (req, res) => {
  console.log(`\n[${new Date().toISOString()}] 🔔 Transcription request received`);

  const audioBuffer = req.body;
  const sampleRateHeader = req.headers['x-sample-rate'];
  const declaredSampleRate = parseInt(sampleRateHeader, 10);
  const audioFormat = req.headers['x-audio-format'] || 'audio/x-signed-linear';

  console.log(`📦 Audio format: ${audioFormat}`);
  console.log(`📏 Buffer size: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
  console.log(`🎚️ Declared Sample Rate (header): ${declaredSampleRate || 'Not Provided'}`);

  if (!audioBuffer || audioBuffer.length === 0) {
    console.error('❌ Error: Empty audio buffer.');
    return res.status(400).json({ message: 'Empty audio buffer received.' });
  }

  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const rawFilePath = path.join(tmpDir, `audio-${id}.raw`);
  const wavFilePath = path.join(tmpDir, `audio-${id}.wav`);

  try {
    // Check that sox is installed and available in the PATH
    try {
      execSync('sox --version', { stdio: 'ignore' });
    } catch (soxCheckError) {
      console.error('❌ Sox is not installed or not available in the PATH.');
      return res.status(500).json({ message: 'Sox is not installed on your system.' });
    }

    // Save raw audio file temporarily
    fs.writeFileSync(rawFilePath, audioBuffer);
    console.log(`💾 (TEMP) Saved raw audio to: ${rawFilePath}`);

    // Convert to WAV (8000 Hz)
    const soxCommand = `sox -r 8000 -e signed-integer -b 16 -c 1 -t raw "${rawFilePath}" "${wavFilePath}"`;
    console.log(`🔧 Executing sox command: ${soxCommand}`);
    execSync(soxCommand, { stdio: 'ignore' });

    if (!fs.existsSync(wavFilePath)) {
      throw new Error('The WAV file was not created by sox.');
    }

    console.log(`✅ (TEMP) WAV file created: ${wavFilePath}`);

    const wavBuffer = fs.readFileSync(wavFilePath);
    console.log(`📤 WAV size: ${(wavBuffer.length / 1024).toFixed(2)} KB`);

    // If you want to keep temporary files, comment out these lines:
    //fs.unlinkSync(rawFilePath);
    //fs.unlinkSync(wavFilePath);
    //console.log('🧹 Temporary files cleaned up');

    // Send to ElevenLabs
    const client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });

    console.log('🚀 Sending WAV to ElevenLabs...');

    const result = await client.speechToText.convert({
      file: new Blob([wavBuffer], { type: 'audio/wav' }),
      model_id: process.env.ELEVENLABS_MODEL_ID || 'scribe_v1',
      num_speakers: 1,
      language_code: process.env.ELEVENLABS_LANGUAGE_CODE || 'es',
      tag_audio_events: false,
      timestamps_granularity: 'none'
    });

    if (result.text) {
      console.log(`📝 Transcription: ${result.text}`);
    } else {
      console.warn('⚠️ No text transcribed.');
    }

    return res.json({ transcription: result.text || '' });
  } catch (err) {
    console.error('❌ Error during audio processing:', err);
    return res.status(500).json({ message: 'Error processing audio', error: err.message });
  }
};

app.post('/transcribe', handleTranscriptionRequest);

const PORT = process.env.PORT || 6022;
app.listen(PORT, () => {
  console.log(`🚀 ElevenLabs STT listening on port ${PORT}`);
});