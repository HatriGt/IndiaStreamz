const constants = require('../utils/constants');

const manifest = {
  id: constants.ADDON_ID,
  version: constants.ADDON_VERSION,
  name: constants.ADDON_NAME,
  description: constants.ADDON_DESCRIPTION,
  resources: [
    'catalog',
    'meta',
    'stream'
  ],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: constants.LANGUAGES.TAMIL,
      name: `${constants.LANGUAGE_NAMES.tamil} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    },
    {
      type: 'movie',
      id: constants.LANGUAGES.TELUGU,
      name: `${constants.LANGUAGE_NAMES.telugu} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    },
    {
      type: 'movie',
      id: constants.LANGUAGES.HINDI,
      name: `${constants.LANGUAGE_NAMES.hindi} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    },
    {
      type: 'movie',
      id: constants.LANGUAGES.MALAYALAM,
      name: `${constants.LANGUAGE_NAMES.malayalam} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    },
    {
      type: 'movie',
      id: constants.LANGUAGES.KANNADA,
      name: `${constants.LANGUAGE_NAMES.kannada} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    },
    {
      type: 'movie',
      id: constants.LANGUAGES.ENGLISH,
      name: `${constants.LANGUAGE_NAMES.english} Movies`,
      extra: [
        {
          name: 'search',
          isRequired: false
        },
        {
          name: 'genre',
          isRequired: false
        },
        {
          name: 'skip',
          isRequired: false
        }
      ]
    }
  ],
  idPrefixes: ['tt', 'tmdb', 'tamil-', 'telugu-', 'hindi-', 'malayalam-', 'kannada-', 'english-', 'multi-']
};

module.exports = manifest;

