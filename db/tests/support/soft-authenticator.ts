// A minimal software WebAuthn authenticator (ES256, "none" attestation), enough
// to drive Better Auth's passkey endpoints without a browser.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto"

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | Record<string, never>

function head(major: number, length: number) {
  if (length < 24) return Buffer.from([(major << 5) | length])
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length])
  if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff])
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(length, 1)
  return b
}

function cbor(value: Cbor): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value)
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8")
    return Buffer.concat([head(3, bytes.length), bytes])
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)])
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)])
  const entries = value instanceof Map ? [...value] : Object.entries(value)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])])
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest()
const b64url = (data: Buffer | Uint8Array) => Buffer.from(data).toString("base64url")

const UP = 0x01
const UV = 0x04
const AT = 0x40

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32)
  private readonly privateKey: KeyObject
  private readonly publicJwk: { x: string; y: string }
  private counter = 0

  constructor(
    readonly rpId: string,
    readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
    this.privateKey = privateKey
    this.publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string }
  }

  private authData(flags: number, attested?: Buffer) {
    const count = Buffer.alloc(4)
    count.writeUInt32BE(this.counter)
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])])
  }

  /** Answer `navigator.credentials.create()` for the given options. */
  register(options: { challenge: string }, { userVerified = true } = {}) {
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(this.publicJwk.x, "base64url")],
      [-3, Buffer.from(this.publicJwk.y, "base64url")],
    ])
    const idLength = Buffer.alloc(2)
    idLength.writeUInt16BE(this.credentialId.length)
    const attested = Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, cbor(coseKey)])
    const authData = this.authData(UP | AT | (userVerified ? UV : 0), attested)
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin, crossOrigin: false }),
    )
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    }
  }

  /** Answer `navigator.credentials.get()` for the given options. */
  authenticate(options: { challenge: string }, { userVerified = true, origin = this.origin } = {}) {
    this.counter += 1
    const authData = this.authData(UP | (userVerified ? UV : 0))
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }),
    )
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey)
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    }
  }
}
