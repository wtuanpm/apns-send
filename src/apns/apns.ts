import { sign, Secret } from 'jsonwebtoken'
import { EventEmitter } from 'events'
import { Errors } from '../constants/errors'
import { Notification } from '../notifications/notification'
import path from 'path'
import { Http2Wrapper } from './http2-wrapper'

// APNS version
const API_VERSION = 3

// Signing algorithm for JSON web token
const SIGNING_ALGORITHM = 'ES256'

// Reset our signing token every 55 minutes as reccomended by Apple
const RESET_TOKEN_INTERVAL_MS = 55 * 60 * 1000

export enum Host {
  production = 'api.push.apple.com',
  development = 'api.sandbox.push.apple.com',
}

export interface SigningToken {
  value: string
  timestamp: number
}

export interface ApnsOptions {
  team: string
  signingKey: Secret
  keyId: string
  defaultTopic?: string
  host?: Host | string
  requestTimeout?: number
  pingInterval?: number
  connections?: number
}

function getUrl(host?: string) {
  return `https://${host ?? Host.production}`
}

export class ApnsClient extends Http2Wrapper {
  readonly team: string
  readonly keyId: string
  readonly host: Host | string
  readonly signingKey: Secret
  readonly defaultTopic?: string

  private _token: SigningToken | null
  private _emitter: EventEmitter

  constructor(options: ApnsOptions) {
    super({
      url: getUrl(options.host),
    })

    //#
    this._emitter = new EventEmitter()

    //#
    this.team = options.team
    this.keyId = options.keyId
    this.signingKey = options.signingKey
    this.defaultTopic = options.defaultTopic
    this.host = options.host ?? Host.production
    this._token = null

    //#
    this._handleEvents()
  }

  send(notification: Notification) {
    return this._push(notification)
  }

  sendMany(notifications: Notification[]) {
    const promises = notifications.map((notification) => {
      return this._push(notification).catch((error: any) => ({
        error,
      }))
    })
    return Promise.all(promises)
  }

  /**
   *
   * @param notification
   * @returns
   */
  private async _push(notification: Notification) {
    return this.request(this._getPath(notification.deviceToken), {
      headers: this._buildHeaders(notification),
      body: JSON.stringify(notification.buildApnsOptions()),
      method: 'POST',
    })
  }

  /**
   *
   * @param notification
   * @returns
   */
  private _buildHeaders(notification: Notification): Record<string, any> {
    const headers: any = {
      authorization: `bearer ${this._getSigningToken()}`,
      'apns-push-type': notification.pushType,
      'apns-priority': notification?.priority?.toString() ?? '0',
      'apns-topic': notification?.options?.topic ?? this.defaultTopic,
      ':method': 'POST',
      ':scheme': 'https',
      ':path': this._getPath(notification?.deviceToken),
    }

    if (notification?.options?.expiration) {
      headers['apns-expiration'] =
        typeof notification.options.expiration === 'number'
          ? notification.options.expiration.toFixed(0)
          : (notification.options.expiration.getTime() / 1000).toFixed(0)
    }

    if (notification?.options?.collapseId) {
      headers['apns-collapse-id'] = notification.options.collapseId
    }

    return headers
  }

  /**
   *
   * @param deviceToken
   * @returns
   */
  private _getPath(deviceToken: string) {
    if (!deviceToken) {
      throw new Error('Device token is required')
    }
    return path.join(`/${API_VERSION}`, `device`, `${deviceToken}`)
  }

  /**
   *
   * @returns
   */
  private _getSigningToken(): string {
    if (
      this._token &&
      Date.now() - this._token.timestamp < RESET_TOKEN_INTERVAL_MS
    ) {
      return this._token.value
    }

    const claims = {
      iss: this.team,
      iat: Math.floor(Date.now() / 1000),
    }

    const token = sign(claims, this.signingKey, {
      algorithm: SIGNING_ALGORITHM,
      header: {
        alg: SIGNING_ALGORITHM,
        kid: this.keyId,
      },
    })

    this._token = {
      value: token,
      timestamp: Date.now(),
    }

    return token
  }

  /**
   *
   */
  private _handleEvents() {
    this._emitter.on(Errors.expiredProviderToken, () =>
      this._resetSigningToken(),
    )
  }

  /**
   *
   */
  private _resetSigningToken() {
    this._token = null
  }
}
