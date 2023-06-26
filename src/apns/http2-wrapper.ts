import http2 from 'http2'
import { getStatusText } from '../helpers/status'

interface IHttp2WrapperOptions {
  url: string
}

interface IRequestOptions {
  headers?: Record<string, any>
  body?: any
  method: 'POST' | 'PUT' | 'DELETE' | 'GET'
  timeout?: number
}

export class Http2Wrapper {
  private _http2Client: http2.ClientHttp2Session

  constructor(options: IHttp2WrapperOptions) {
    this._http2Client = http2.connect(options.url)
  }

  async request(path: string, options: IRequestOptions) {
    const req = this._http2Client.request(
      {
        ...(options?.headers ?? {}),
        [http2.constants.HTTP2_HEADER_METHOD]: options.method,
        [http2.constants.HTTP2_HEADER_PATH]: path,
      },
      { endStream: !options?.body },
    )

    if (options?.body) {
      req.write(options.body)
    }

    req.end()

    const { headers, status } = await this._responseHeaders(
      req,
      options.timeout,
    )

    const body = await this._responseJson(req)
    const statusText = getStatusText(status)

    return {
      status,
      statusText,
      headers,
      body,
    }
  }

  _responseHeaders(
    req: http2.ClientHttp2Stream,
    timeout?: number,
  ): Promise<{ headers: http2.IncomingHttpHeaders; status: number }> {
    return new Promise((resolve, reject) => {
      if (timeout) {
        req.setTimeout(timeout ?? 5000, reject)
      }

      req.on('error', reject)

      req.on('response', (headers) =>
        resolve({
          headers,
          status: Number(headers[http2.constants.HTTP2_HEADER_STATUS]),
        }),
      )
    })
  }

  _responseJson(req: http2.ClientHttp2Stream) {
    return new Promise((resolve, reject) => {
      const chunks: any = []

      req.on('error', reject)

      req.on('data', (chunk) => chunks.push(chunk))

      req.on('end', () => {
        req.destroy()
        req.removeAllListeners()

        resolve(this._convertBufferToJson(Buffer.concat(chunks)))
      })
    })
  }

  _convertBufferToJson(buffer: Buffer) {
    if (buffer && typeof buffer) {
      const text = buffer.toString('utf8')
      return text ? JSON.parse(text) : undefined
    }
  }
}
