import express, { json, urlencoded, Response } from 'express'
import path from 'path'
import cors from 'cors'
import helmet from 'helmet'
import session, { SessionOptions } from 'express-session'
import swaggerUi from 'swagger-ui-express'
import swaggerDocument from 'swagger/definition.json'
import { errorHandler } from 'middleware/error'
import { notFoundHandler } from 'middleware/notfound'
import { logHandler } from 'middleware/log'
import { router } from './routes'
import { SERVER_CONFIG, SESSION_CONFIG } from 'utils/config'
import createMemoryStore from 'memorystore'

const app = express()

// configure express app
app.use(helmet())
app.use((req, res: Response, next) => {
  json({
    verify: (req, res: Response, buf) => {
      if (req.method === 'POST') {
        console.log('Raw POST request body:', buf.toString())
      }
      try {
        JSON.parse(buf.toString())
      } catch (e) {
        const error = e as Error;
        console.error('JSON parsing error:', error.message)
        console.error('Problematic JSON string:', buf.toString())
        res.status(400).json({ error: 'Invalid JSON', details: error.message })
        throw new Error('Invalid JSON: ' + error.message)
      }
    }
  })(req, res, next)
})

app.use(urlencoded({ extended: true }))
app.use(logHandler)

const corsConfig: cors.CorsOptions = {}
if (SERVER_CONFIG.NODE_ENV === 'production') {
  // corsConfig.origin = '*', // allow all origins
  corsConfig.origin = ['https://www.devcon.org/', /\.devcon\.org$/] 
  corsConfig.credentials = true
}
app.use(cors(corsConfig))

const store = createMemoryStore(session)
const sessionConfig: SessionOptions = {
  name: SESSION_CONFIG.cookieName,
  secret: SESSION_CONFIG.password,
  cookie: {},
  resave: false,
  saveUninitialized: true,
  store: new store({
    checkPeriod: 86400000, // prune expired entries every 24h
  }),
}

if (SERVER_CONFIG.NODE_ENV === 'production') {
  app.set('trust proxy', 1) // for secure cookies and when using HTTPS: https://expressjs.com/en/guide/behind-proxies.html
  sessionConfig.cookie = { ...sessionConfig.cookie, secure: true }
}
app.use(session(sessionConfig))

// static endpoints
app.use('/static', express.static(path.join(__dirname, '..', 'public')))
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))

// add routes before error handlers
app.use(router)

// add handlers after routes
app.use(errorHandler)
app.use(notFoundHandler)

export default app