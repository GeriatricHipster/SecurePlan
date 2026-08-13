function isAzureOpenAiConfigured(config) {
  return Boolean(config.azureOpenaiEndpoint && config.azureOpenaiApiKey && config.azureOpenaiTranscribeDeployment && config.azureOpenaiChatDeployment);
}

function isOpenAiConfigured(config) {
  return Boolean(config.openaiApiKey);
}

export function isAiConfigured(config) {
  return isAzureOpenAiConfigured(config) || isOpenAiConfigured(config);
}

async function transcribeViaOpenAi(config, buffer, mimetype) {
  const form = new FormData();
  const filename = mimetype === 'video/mp4' ? 'recording.mp4' : 'recording.webm';
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  form.append('model', config.openaiTranscribeModel || 'gpt-transcribe');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Transcription failed via OpenAI (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.text || '';
}

async function transcribeViaAzure(config, buffer, mimetype) {
  const form = new FormData();
  const filename = mimetype === 'video/mp4' ? 'recording.mp4' : 'recording.webm';
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  const url = `${config.azureOpenaiEndpoint}/openai/deployments/${config.azureOpenaiTranscribeDeployment}/audio/transcriptions?api-version=2025-01-01-preview`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': config.azureOpenaiApiKey },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Transcription failed via Azure OpenAI (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.text || '';
}

export async function transcribeRecording(config, buffer, mimetype) {
  if (isAzureOpenAiConfigured(config)) return transcribeViaAzure(config, buffer, mimetype);
  if (isOpenAiConfigured(config)) return transcribeViaOpenAi(config, buffer, mimetype);
  throw new Error('No AI transcription provider is configured.');
}

const REPORT_SYSTEM_PROMPT = `You are helping a security systems installer turn a spoken, in-the-field voice note into a clean, professional written field report.

Structure the report with these sections, using clear Markdown headings:
## Summary
A brief 1-2 sentence overview of what this visit/update covered.
## Work completed
A bulleted list of what was done, installed, tested, or observed.
## Issues or concerns
Anything flagged as a problem, blocker, or needing follow-up. Omit this section entirely if nothing was mentioned.
## Next steps
Any planned follow-up actions mentioned. Omit this section entirely if none were mentioned.

Write in clear, professional prose based ONLY on what was actually said in the transcript. Do not invent details, equipment, or issues that weren't mentioned. If the transcript is unclear or fragmentary in places, write the report around what IS clear rather than guessing.`;

async function chatCompletionViaOpenAi(config, transcript, context) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiChatModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: `Survey: ${context.surveyName || 'Unknown'}\nSite: ${context.siteName || 'Unknown'}\n\nTranscript:\n${transcript}` },
      ],
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Report generation failed via OpenAI (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function chatCompletionViaAzure(config, transcript, context) {
  const url = `${config.azureOpenaiEndpoint}/openai/deployments/${config.azureOpenaiChatDeployment}/chat/completions?api-version=2025-01-01-preview`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': config.azureOpenaiApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: `Survey: ${context.surveyName || 'Unknown'}\nSite: ${context.siteName || 'Unknown'}\n\nTranscript:\n${transcript}` },
      ],
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Report generation failed via Azure OpenAI (${response.status}): ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function generateFieldReport(config, transcript, context = {}) {
  if (isAzureOpenAiConfigured(config)) return chatCompletionViaAzure(config, transcript, context);
  if (isOpenAiConfigured(config)) return chatCompletionViaOpenAi(config, transcript, context);
  throw new Error('No AI report-generation provider is configured.');
}
