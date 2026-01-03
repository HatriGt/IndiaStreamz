/**
 * Handle configuration requests for Stremio addon
 * Provides configuration form for Torbox API settings
 */
async function handleConfigure(args) {
  return {
    type: 'other',
    name: 'IndiaStreamz Configuration',
    description: 'Configure your Torbox API settings to enable web player support',
    fields: [
      {
        type: 'text',
        name: 'torboxApiKey',
        label: 'Torbox API Key',
        placeholder: 'Enter your Torbox API key',
        value: args?.torboxApiKey || ''
      },
      {
        type: 'text',
        name: 'torboxApiUrl',
        label: 'Torbox API URL (optional)',
        placeholder: 'https://api.torbox.app',
        value: args?.torboxApiUrl || 'https://api.torbox.app'
      }
    ]
  };
}

module.exports = handleConfigure;

