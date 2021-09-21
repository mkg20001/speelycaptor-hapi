'use strict'

/* eslint-disable no-negated-condition */

const Hapi = require('@hapi/hapi')
const Boom = require('@hapi/boom')
const Joi = require('joi')
const fs = require('fs')
const crypto = require('crypto')
const rimraf = require('rimraf').sync
const mkdirp = require('mkdirp').sync
const path = require('path')

const { spawn, execFile } = require('child_process')

const VIDEO_MAX_DURATION = 600

const prom = fnc => new Promise((resolve, reject) => fnc((err, res) => err ? reject(err) : resolve(res)))

const createKey = () => crypto.randomBytes(64).toString('hex')

const pino = require('pino')
const log = pino({ name: 'speelycaptor' })

const Relish = require('relish2')({
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

function tmpTracker (location) {
  const storage = path.join(location, 'config.json')
  const db = fs.existsSync(storage) ? JSON.parse(String(fs.readFileSync(storage))) : {}

  const f = k => path.join(location, `file_${k}`)

  function write () {
    fs.writeFileSync(storage, JSON.stringify(db))
  }

  async function check () {
    const now = Date.now()

    const rm = []

    for (const key in db) {
      if (db[key] < now) {
        const p = f(key)
        if (fs.existsSync(p)) {
          rm.push(removeFile(p))
        }
        delete db[key]
      }
    }

    await Promise.all(rm)
    write()
  }

  setInterval(check, 60 * 1000).unref()

  return {
    getNew (expiresInSeconds) {
      const key = createKey()
      db[key] = Date.now() + (expiresInSeconds * 1000)
      write()

      return {
        path: f(key),
        key
      }
    },
    async delTmp (key) {
      if (!db[key]) {
        return
      }

      const p = f(key)

      if (fs.existsSync(p)) {
        await removeFile(p)
      }

      delete db[key]
      write()
    },
    getKey (key) {
      if (!db[key]) {
        throw Boom.badRequest('Specified file key invalid')
      }

      return {
        path: f(key),
        key
      }
    }
  }
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
  const tracked = tmpTracker(tmp)
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

  server.route({
    method: 'GET',
    path: '/init',
    config: {
      handler: async (req, h) => {
        const input = tracked.getNew(240)

        return {
          uploadUrl: `${externalUrl}/push/${input.key}`,
          key: input.key
        }
      }
    }
  })

  // S3 Simulator 2021 Edition

  server.route({
    method: 'POST',
    path: '/push/{key}',
    /* payload: {
      multipart: {
        output: 'stream'
      },
      output: 'stream',
      parse: true,
      allow: 'multipart/form-data'
    }, */
    config: {
      handler: async (req, h) => {
        const { key } = req.params

        const input = tracked.getKey(key)

        // TODO: handle file post properly and move to input.path
      }
    }
  })

  server.route({
    method: 'GET',
    path: '/pull/{key}',
    config: {
      handler: async (req, h) => {
        const { key } = req.params

        const output = tracked.getKey(key)

        return h.file(output.path, { confine: false })
      }
    }
  })

  server.route({
    method: 'POST',
    path: '/convert',
    config: {
      handler: async (req, h) => {
        const { key, args } = req.query
        // key=file id
        // args=ffmpeg args

        const input = tracked.getKey(key)
        const output = tracked.getNew(240)

        await ffmpeg(args, input.path, output.path)

        return {
          url: `${externalUrl}/pull/${output.key}`
        }
      },
      validate: {
        query: Joi.object({
          key: Joi.string().required(),
          args: Joi.string().required()
        }).options({ stripUnknown: true })
      }
    }
  })
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
