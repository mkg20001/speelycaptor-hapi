#!/usr/bin/env node

'use strict'

const path = require('path')
const os = require('os')

const Joi = require('@hapi/joi')

require('mkg-bin-gen')(
  'speelycaptor',
  {
    validator: Joi.object({
      hapi: Joi.object({
        host: Joi.string().default('::'),
        port: Joi.number().integer().default(34221)
      }).pattern(/./, Joi.any()).required(),
      tmpFolder: Joi.string().default(path.join(os.tmpdir(), 'speelycaptor')),
      externalUrl: Joi.string().uri().required()
    })
  },
  require('.')
)
