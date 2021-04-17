'use strict'

/* eslint-disable guard-for-in */
/* eslint-disable no-loop-func */

const Hapi = require('@hapi/hapi')
const Joi = require('@hapi/joi')
const fs = require('fs')
const crypto = require('crypto')
const rimraf = require('rimraf').sync
const mkdirp = require('mkdirp').sync
const path = require('path')

const { spawn, execFile } = require('child_process')

const VIDEO_MAX_DURATION = 600

const prom = fnc => new Promise((resolve, reject) => fnc((err, res) => err ? reject(err) : resolve(res)))

const randName = () => crypto.randomBytes(64).toString('hex')

const pino = require('pino')
const log = pino({ name: 'speelycaptor' })

const Relish = require('relish')({
  messages: {}
})

function ffprobe (tmp, file) {
  log('Starting FFprobe')

  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-i', file]
    const opts = {
      cwd: tmp
    }
    const cb = (error, stdout) => {
      if (error) reject(error)

      log(stdout)

      const { streams, format } = JSON.parse(stdout)
      log(JSON.stringify(streams))
      log(JSON.stringify(format))

      const hasVideoStream = streams.some(({ codecType, duration }) => {
        if (codecType !== 'video') return false

        // Allow non-duration videos, currently known to be created by Oculus Browser
        if (!duration && !format.duration) return true
        return (duration || format.duration) <= VIDEO_MAX_DURATION
      })

      if (!hasVideoStream) reject(new Error('FFprobe: no valid video stream found'))
      else {
        log('Valid video stream found. FFprobe finished.')
        resolve()
      }
    }

    execFile('ffprobe', args, opts, cb).on('error', reject)
  })
}

function ffmpeg (ffmpegArgs, input, output) {
  log('Starting FFmpeg')

  return new Promise((resolve, reject) => {
    const args = ['-y', '-loglevel', 'warning', '-i', input, ...ffmpegArgs.split(' '), output]

    log(args)

    spawn('ffmpeg', args, {})
      .on('message', msg => log(msg))
      .on('error', reject)
      .on('close', resolve)
  })
}

function removeFile (localFilePath) {
  log(`Deleting ${localFilePath}`)

  return prom(cb => fs.unlink(localFilePath, cb))
}

const init = async config => {
  config.hapi.routes = {
    validate: {
      failAction: Relish.failAction
    }
  }

  rimraf(config.tmpFolder)
  mkdirp(config.tmpFolder)
  const tmp = fs.realpathSync(config.tmpFolder)
  const { externalUrl } = config
  const server = Hapi.server(config.hapi)

  await server.register({
    plugin: require('hapi-pino'),
    options: { name: 'speelycaptor' }
  })

  if (global.SENTRY) {
    await server.register({
      plugin: require('hapi-sentry'),
      options: { client: global.SENTRY }
    })
  }

  await server.register({
    plugin: require('@hapi/inert')
  })

  // main logic

  /* for (const form in config.forms) {
    const formConfig = config.forms[form]

    const mailConfig = Object.assign(Object.assign({}, mainMailConfig), formConfig.mail) // we can't prefill defaults with joi in subconfig because default override main so we prefill them in main and clone+override that here

    const validatorInner = Object.keys(formConfig.fields).reduce((out, field) => {
      const fieldConfig = formConfig.fields[field] // TODO: prefill defaults with joi

      let v

      switch (fieldConfig.type) {
        case 'string': {
          v = Joi.string()

          if (fieldConfig.required) {
            v = v.required()
          }

          if (fieldConfig.maxLen) {
            v = v.max(fieldConfig.maxLen)
          }

          if (fieldConfig.minLen) {
            v = v.min(fieldConfig.minLen)
          }
          break
        }

        case 'file': {
          v = Joi.any() // TOOD: add file validator
          break
        }

        default: {
          throw new TypeError(fieldConfig.type)
        }
      }

      out[field] = v

      return out
    }, {})

    let validator = Joi.object(validatorInner)

    if (formConfig.appendGeneric) {
      validator = validator.pattern(/./, Joi.string().min(1).max(1024)) // TODO: rethink if string or allow all, but string with def should be good
    }

    validator = validator.required()

    await server.route({
      method: 'POST',
      path: '/' + form,
      config: {
        payload: {
          multipart: {
            output: 'stream'
          },
          * maxBytes: 209715200,
          output: 'stream',
          parse: true, *
          output: 'stream',
          parse: true,
          allow: 'multipart/form-data'
        },
        handler: async (h, reply) => {
          const { payload: params } = h

          for (const key in params) {
            params[key] = escape(params[key])
          }

          const values = Object.keys(params).reduce((out, key) => {
            out[key.toUpperCase()] = handleField(formConfig.fields[key] || fieldDefault, key, params[key])

            return out
          }, {})

          for (const key in values) {
            values[key] = await values[key] // resolve promises
          }

          if (formConfig.appendGeneric) {
            values._GENERIC = Object.keys(params).filter(key => Boolean(formConfig.fields[key])).map(key => `${key}:\n\n${params[key]}`).join('\n\n')
          }

          const mail = Object.assign({}, mailConfig)

          if (formConfig.text) {
            mail.text = formConfig.text
          }

          if (formConfig.html) {
            mail.html = formConfig.html
            // TODO: add nodemailer plugin that transforms html to text if no text
          }

          // NOTE: html fallback is already covered by plugin

          // render all keys, including subject
          for (const key in mail) {
            mail[key] = renderTemplate(mail[key], values)
          }

          if (!mail.html) {
            mail.html = mail.text.replace(/(\r\n|\n)/g, '<br>') // fallback
          }

          const res = await mailer.sendMail(mail) // NOTE: this only says "mail is now in queue and being processed" not "it arrived"

          return { ok: true, msgId: res.messageId } // TODO: should we expose this? it's good for tracking since that's something "an email" can be referred to, but fairly useless to the customer... could be displayed as "keep that" or sth
        },
        validate: {
          payload: validator
        }
      }
    })
  }

  server.route({
    method: 'GET',
    path: '/file/{filename}',
    config: {
      validate: {
        params: Joi.object({
          filename: Joi.string().pattern(/[a-z0-9.]/mi)
        })
      },
      handler: (request, h) => {
        return h.file(path.join(storagePath, request.params.filename), {
          confine: false
        })
      }
    }

  }) */

  async function stop () {
    await server.stop()
  }

  await server.start()

  process.on('SIGINT', () => {
    stop()
  })

  process.on('SIGTERM', () => {
    stop()
  })
}

module.exports = init
