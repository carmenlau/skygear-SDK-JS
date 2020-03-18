import {
  JSONObject,
  AuthResponse,
  SSOLoginOptions,
  Session,
  Identity,
  FullOAuthAuthorizationURLOptions,
  Authenticator,
  ActivateTOTPResult,
  AuthenticateWithTOTPOptions,
  CreateNewTOTPOptions,
  CreateNewTOTPResult,
  CreateNewOOBOptions,
  CreateNewOOBResult,
  ActivateOOBResult,
  AuthenticateWithOOBOptions,
  AuthenticationSession,
  _PresignUploadRequest,
  _PresignUploadResponse,
  _PresignUploadFormResponse,
  _OIDCConfiguration,
} from "./types";
import { decodeError, SkygearError } from "./error";
import { encodeQuery } from "./url";
import {
  decodeAuthResponse,
  decodeSession,
  decodeAuthenticator,
  decodeIdentity,
} from "./encoding";
import { _encodeBase64FromString } from "./base64";

/**
 * @internal
 */
export function _removeTrailingSlash(s: string): string {
  return s.replace(/\/+$/g, "");
}

/**
 * @internal
 * @param appEndpoint - app default endpoint, support url with protocol https, http or empty.
 * @param gearSubdomain - gear subdomain, e.g. accounts, assets
 */
export function _gearEndpoint(
  appEndpoint: string,
  gearSubdomain: string
): string {
  const gearEndpoint = appEndpoint.replace(
    /^(http:\/\/|https:\/\/|\/\/)(.*)$/g,
    `$1${gearSubdomain}.$2`
  );
  if (gearEndpoint === appEndpoint) {
    throw new Error("invalid app endpoint");
  }

  return gearEndpoint;
}

function shouldRefreshToken(r: Response): boolean {
  const h = r.headers.get("x-skygear-try-refresh-token");
  return h === "true";
}

function extractSingleKeyValue(
  o: { [key: string]: string },
  errorMessage: string
): [string, string] {
  const keys = Object.keys(o);
  if (keys.length !== 1) {
    throw new Error(errorMessage);
  }
  return [keys[0], o[keys[0]]];
}

/**
 * @public
 */
export abstract class BaseAPIClient {
  apiKey: string;
  endpoint: string;
  authEndpoint: string;
  assetEndpoint: string;
  /**
   * @internal
   */
  _accessToken: string | null;
  /**
   * @internal
   */
  _authenticationSession: AuthenticationSession | null;
  fetchFunction?: typeof fetch;
  requestClass?: typeof Request;
  refreshTokenFunction?: () => Promise<boolean>;
  userAgent?: string;
  getExtraSessionInfo?: () => Promise<JSONObject | null>;

  constructor() {
    this.apiKey = "";
    this.endpoint = "";
    this.authEndpoint = "";
    this.assetEndpoint = "";
    this._accessToken = null;
    this._authenticationSession = null;
  }

  async setEndpoint(
    appEndpoint: string,
    authEndpoint?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    assetEndpoint?: string
  ) {
    // TODO: support gears endpoint in apiClient
    this.endpoint = _removeTrailingSlash(appEndpoint);
    this.authEndpoint = authEndpoint
      ? authEndpoint
      : _gearEndpoint(this.endpoint, "accounts");
    this.assetEndpoint = assetEndpoint
      ? assetEndpoint
      : _gearEndpoint(this.endpoint, "assets");
  }

  protected async prepareHeaders(): Promise<{ [name: string]: string }> {
    const headers: { [name: string]: string } = {
      "x-skygear-api-key": this.apiKey,
    };
    if (this._accessToken) {
      headers["authorization"] = `bearer ${this._accessToken}`;
    }
    if (this.userAgent !== undefined) {
      headers["user-agent"] = this.userAgent;
    }
    if (this.getExtraSessionInfo) {
      const extraSessionInfo = await this.getExtraSessionInfo();
      if (extraSessionInfo) {
        headers["x-skygear-extra-info"] = _encodeBase64FromString(
          JSON.stringify(extraSessionInfo)
        );
      }
    }
    return headers;
  }

  /**
   * @internal
   */
  async _fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.fetchFunction == null) {
      throw new Error("missing fetchFunction in oidc api client");
    }

    if (this.requestClass == null) {
      throw new Error("missing requestClass in oidc api client");
    }
    const request = new this.requestClass(url, init);
    return this.fetchFunction(request);
  }

  /**
   * @internal
   */
  async _fetchJSON(url: string, init?: RequestInit): Promise<any> {
    const resp = await this._fetch(url, init);
    return resp.json();
  }

  async fetch(
    input: string,
    init?: RequestInit,
    options: { autoRefreshToken?: boolean } = {}
  ): Promise<Response> {
    if (this.fetchFunction == null) {
      throw new Error("missing fetchFunction in api client");
    }

    if (this.requestClass == null) {
      throw new Error("missing requestClass in api client");
    }

    const { autoRefreshToken = !!this.refreshTokenFunction } = options;

    if (typeof input !== "string") {
      throw new Error("only string path is allowed for fetch input");
    }

    const url = this.endpoint + "/" + input.replace(/^\//, "");
    const request = new this.requestClass(url, init);

    const headers = await this.prepareHeaders();
    for (const key of Object.keys(headers)) {
      request.headers.set(key, headers[key]);
    }

    let response = await this.fetchFunction(request.clone());
    if (shouldRefreshToken(response) && autoRefreshToken) {
      if (!this.refreshTokenFunction) {
        throw new Error("missing refreshTokenFunction in api client");
      }

      const tokenRefreshed = await this.refreshTokenFunction();
      if (tokenRefreshed) {
        const retryRequest = request.clone();
        // use latest access token
        const headers = await this.prepareHeaders();
        for (const key of Object.keys(headers)) {
          retryRequest.headers.set(key, headers[key]);
        }

        response = await this.fetchFunction(retryRequest);
      }
    }

    return response;
  }

  protected async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: {
      json?: JSONObject;
      query?: [string, string][];
      autoRefreshToken?: boolean;
    } = {}
  ): Promise<any> {
    const { json, query, autoRefreshToken } = options;
    let p = path;
    if (query != null) {
      p += encodeQuery(query);
    }

    const headers: { [name: string]: string } = {};
    if (json != null) {
      headers["content-type"] = "application/json";
    }

    const response = await this.fetch(
      p,
      {
        method,
        headers,
        mode: "cors",
        credentials: "include",
        body: json && JSON.stringify(json),
      },
      { autoRefreshToken }
    );

    let jsonBody;
    try {
      jsonBody = await response.json();
    } catch (err) {
      if (response.status < 200 || response.status >= 300) {
        throw new SkygearError(
          "unexpected status code",
          "InternalError",
          "UnexpectedError",
          {
            status_code: response.status,
          }
        );
      } else {
        throw new SkygearError(
          "failed to decode response JSON",
          "InternalError",
          "UnexpectedError"
        );
      }
    }

    if (jsonBody["result"]) {
      return jsonBody["result"];
    } else if (jsonBody["error"]) {
      throw decodeError(jsonBody["error"]);
    }

    throw decodeError();
  }

  protected async post(
    path: string,
    options?: {
      json?: JSONObject;
      query?: [string, string][];
      autoRefreshToken?: boolean;
    }
  ): Promise<any> {
    return this.request("POST", path, options);
  }

  protected async get(
    path: string,
    options?: { query?: [string, string][]; autoRefreshToken?: boolean }
  ): Promise<any> {
    return this.request("GET", path, options);
  }

  protected async del(
    path: string,
    options: {
      json?: JSONObject;
      query?: [string, string][];
      autoRefreshToken?: boolean;
    }
  ): Promise<any> {
    return this.request("DELETE", path, options);
  }

  protected async postAndReturnAuthResponse(
    path: string,
    options?: {
      json?: JSONObject;
      query?: [string, string][];
      autoRefreshToken?: boolean;
    }
  ): Promise<AuthResponse> {
    const response = await this.post(path, options);
    return decodeAuthResponse(response);
  }

  /**
   * @internal
   */
  makePayloadWithAuthenticationSessionToken(payload: JSONObject): JSONObject {
    if (this._authenticationSession != null) {
      const newPayload = {
        ...payload,
        authn_session_token: this._authenticationSession.token,
      };
      return newPayload;
    }
    return payload;
  }

  async signup(
    loginIDs: { [key: string]: string }[] | { [key: string]: string },
    password: string,
    options?: {
      metadata?: JSONObject;
    }
  ): Promise<AuthResponse> {
    const ids: { key: string; value: string }[] = [];
    if (Array.isArray(loginIDs)) {
      for (const obj of loginIDs) {
        for (const key of Object.keys(obj)) {
          const value = obj[key];
          ids.push({ key, value });
        }
      }
    } else {
      for (const key of Object.keys(loginIDs)) {
        const value = loginIDs[key];
        ids.push({ key, value });
      }
    }
    const payload = {
      password,
      login_ids: ids,
      metadata: options && options.metadata,
    };
    return this.postAndReturnAuthResponse("/_auth/signup", { json: payload });
  }

  async login(
    loginID: string,
    password: string,
    options?: { loginIDKey?: string }
  ): Promise<AuthResponse> {
    const payload = {
      password,
      login_id: loginID,
      login_id_key: options && options.loginIDKey,
    };
    return this.postAndReturnAuthResponse("/_auth/login", { json: payload });
  }

  async logout(): Promise<void> {
    await this.post("/_auth/logout", { json: {} });
  }

  async refresh(refreshToken: string): Promise<string> {
    const payload = {
      refresh_token: refreshToken,
    };
    const response = await this.post("/_auth/refresh", {
      json: payload,
      autoRefreshToken: false,
    });
    return response.access_token;
  }

  async me(): Promise<AuthResponse> {
    return this.postAndReturnAuthResponse("/_auth/me", { json: {} });
  }

  async changePassword(
    newPassword: string,
    oldPassword: string
  ): Promise<AuthResponse> {
    const payload = {
      password: newPassword,
      old_password: oldPassword,
    };
    return this.postAndReturnAuthResponse("/_auth/change_password", {
      json: payload,
    });
  }

  async updateMetadata(metadata: JSONObject): Promise<AuthResponse> {
    const payload = { metadata };
    return this.postAndReturnAuthResponse("/_auth/update_metadata", {
      json: payload,
    });
  }

  async requestForgotPasswordEmail(email: string): Promise<void> {
    const payload = { email };
    await this.post("/_auth/forgot_password", { json: payload });
  }

  async resetPassword(form: {
    userID: string;
    code: string;
    expireAt: number;
    newPassword: string;
  }): Promise<void> {
    const payload = {
      user_id: form.userID,
      code: form.code,
      expire_at: form.expireAt,
      new_password: form.newPassword,
    };
    await this.post("/_auth/forgot_password/reset_password", { json: payload });
  }

  async requestEmailVerification(email: string): Promise<void> {
    const payload = {
      login_id_type: "email",
      login_id: email,
    };
    await this.post("/_auth/verify_request", { json: payload });
  }

  async requestPhoneVerification(phone: string): Promise<void> {
    const payload = {
      login_id_type: "phone",
      login_id: phone,
    };
    await this.post("/_auth/verify_request", { json: payload });
  }

  async verifyWithCode(code: string): Promise<void> {
    const payload = { code };
    await this.post("/_auth/verify_code", { json: payload });
  }

  async loginWithCustomToken(
    token: string,
    options?: SSOLoginOptions
  ): Promise<AuthResponse> {
    const payload = {
      token,
      on_user_duplicate: options && options.onUserDuplicate,
    };
    return this.postAndReturnAuthResponse("/_auth/sso/custom_token/login", {
      json: payload,
    });
  }

  async oauthAuthorizationURL(
    options: FullOAuthAuthorizationURLOptions
  ): Promise<string> {
    const {
      providerID,
      uxMode,
      onUserDuplicate,
      codeChallenge,
      action,
    } = options;
    const encoded = encodeURIComponent(providerID);
    let path = "";
    switch (action) {
      case "login":
        path = `/_auth/sso/${encoded}/login_auth_url`;
        break;
      case "link":
        path = `/_auth/sso/${encoded}/link_auth_url`;
        break;
      default:
        throw new Error("unreachable");
    }

    const callbackURL =
      ("callbackURL" in options && options.callbackURL) ||
      (typeof window !== "undefined" && window.location.href);

    if (!callbackURL) {
      throw new Error("callbackURL is required");
    }

    const payload = {
      callback_url: callbackURL,
      ux_mode: uxMode,
      on_user_duplicate: onUserDuplicate,
      code_challenge: codeChallenge,
    };
    return this.post(path, { json: payload });
  }

  async oauthHandler(options: {
    providerID: string;
    code: string;
    scope: string;
    state: string;
  }): Promise<string> {
    const { providerID, code, scope, state } = options;
    const encoded = encodeURIComponent(providerID);
    const path = `/_auth/sso/${encoded}/auth_handler`;
    return this.get(path, {
      query: [["code", code], ["scope", scope], ["state", state]],
    });
  }

  async getOAuthResult(options: {
    authorizationCode: string;
    codeVerifier: string;
  }): Promise<AuthResponse> {
    const { authorizationCode, codeVerifier } = options;
    const payload = {
      authorization_code: authorizationCode,
      code_verifier: codeVerifier,
    };
    return this.postAndReturnAuthResponse("/_auth/sso/auth_result", {
      json: payload,
    });
  }

  async deleteOAuthProvider(providerID: string): Promise<void> {
    const encoded = encodeURIComponent(providerID);
    await this.post(`/_auth/sso/${encoded}/unlink`, { json: {} });
  }

  async loginOAuthProviderWithAccessToken(
    providerID: string,
    accessToken: string,
    options?: SSOLoginOptions
  ): Promise<AuthResponse> {
    const encoded = encodeURIComponent(providerID);
    const payload = {
      access_token: accessToken,
      on_user_duplicate: options && options.onUserDuplicate,
    };
    return this.postAndReturnAuthResponse(`/_auth/sso/${encoded}/login`, {
      json: payload,
    });
  }

  async linkOAuthProviderWithAccessToken(
    providerID: string,
    accessToken: string
  ): Promise<AuthResponse> {
    const encoded = encodeURIComponent(providerID);
    const payload = {
      access_token: accessToken,
    };
    return this.postAndReturnAuthResponse(`/_auth/sso/${encoded}/link`, {
      json: payload,
    });
  }

  async listSessions(): Promise<Session[]> {
    const response = await this.post("/_auth/session/list", { json: {} });
    return (response.sessions as any[]).map(decodeSession);
  }

  async getSession(id: string): Promise<Session> {
    const payload = { session_id: id };
    const response = await this.post("/_auth/session/get", { json: payload });
    return decodeSession(response.session);
  }

  async revokeSession(id: string): Promise<void> {
    const payload = { session_id: id };
    return this.post("/_auth/session/revoke", { json: payload });
  }

  async revokeOtherSessions(): Promise<void> {
    return this.post("/_auth/session/revoke_all", { json: {} });
  }

  async listIdentities(): Promise<Identity[]> {
    const response = await this.post("/_auth/identity/list", { json: {} });
    return (response.identities as any[]).map(decodeIdentity);
  }

  async addLoginID(...loginIDs: { [key: string]: string }[]): Promise<void> {
    const mappedLoginIDs = loginIDs.map(loginID => {
      const [key, value] = extractSingleKeyValue(
        loginID,
        "must provide exactly one login ID"
      );
      return { key, value };
    });
    return this.post("/_auth/login_id/add", {
      json: { login_ids: mappedLoginIDs },
    });
  }

  async removeLoginID(loginID: { [key: string]: string }): Promise<void> {
    const [key, value] = extractSingleKeyValue(
      loginID,
      "must provide exactly one login ID"
    );
    return this.post("/_auth/login_id/remove", {
      json: { key, value },
    });
  }

  async updateLoginID(
    oldLoginID: { [key: string]: string },
    newLoginID: { [key: string]: string }
  ): Promise<AuthResponse> {
    const [oldKey, oldValue] = extractSingleKeyValue(
      oldLoginID,
      "must provide exactly one old login ID"
    );
    const [newKey, newValue] = extractSingleKeyValue(
      newLoginID,
      "must provide exactly one new login ID"
    );
    return this.postAndReturnAuthResponse("/_auth/login_id/update", {
      json: {
        old_login_id: { key: oldKey, value: oldValue },
        new_login_id: { key: newKey, value: newValue },
      },
    });
  }

  async listRecoveryCode(): Promise<string[]> {
    const response = await this.post("/_auth/mfa/recovery_code/list", {
      json: {},
    });
    return response.recovery_codes;
  }

  async regenerateRecoveryCode(): Promise<string[]> {
    const response = await this.post("/_auth/mfa/recovery_code/regenerate", {
      json: {},
    });
    return response.recovery_codes;
  }

  async authenticateWithRecoveryCode(code: string): Promise<AuthResponse> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      code,
    });
    return this.postAndReturnAuthResponse(
      "/_auth/mfa/recovery_code/authenticate",
      { json: payload }
    );
  }

  async getAuthenticators(): Promise<Authenticator[]> {
    const payload = this.makePayloadWithAuthenticationSessionToken({});
    const response = await this.post("/_auth/mfa/authenticator/list", {
      json: payload,
    });
    return (response.authenticators as any[]).map(decodeAuthenticator);
  }

  async deleteAuthenticator(id: string): Promise<void> {
    await this.post("/_auth/mfa/authenticator/delete", {
      json: {
        authenticator_id: id,
      },
    });
  }

  async createNewTOTP(
    options: CreateNewTOTPOptions
  ): Promise<CreateNewTOTPResult> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      display_name: options.displayName,
      issuer: options.issuer,
      account_name: options.accountName,
    });
    const response = await this.post("/_auth/mfa/totp/new", {
      json: payload,
    });
    return {
      authenticatorID: response.authenticator_id,
      authenticatorType: response.authenticator_type,
      secret: response.secret,
      otpauthURI: response.otpauth_uri,
      qrCodeImageURI: response.qr_code_image_uri,
    };
  }

  async activateTOTP(otp: string): Promise<ActivateTOTPResult> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      otp,
    });
    const response = await this.post("/_auth/mfa/totp/activate", {
      json: payload,
    });
    return {
      recoveryCodes: response.recovery_codes,
    };
  }

  async authenticateWithTOTP(
    options: AuthenticateWithTOTPOptions
  ): Promise<AuthResponse> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      request_bearer_token: options.skipMFAForCurrentDevice,
      otp: options.otp,
    });
    return this.postAndReturnAuthResponse("/_auth/mfa/totp/authenticate", {
      json: payload,
    });
  }

  async createNewOOB(
    options: CreateNewOOBOptions
  ): Promise<CreateNewOOBResult> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      channel: options.channel,
      phone: (options as any).phone,
      email: (options as any).email,
    });
    const response = await this.post("/_auth/mfa/oob/new", {
      json: payload,
    });
    return {
      authenticatorID: response.authenticator_id,
      authenticatorType: response.authenticator_type,
      channel: response.channel,
    };
  }

  async activateOOB(code: string): Promise<ActivateOOBResult> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      code,
    });
    const response = await this.post("/_auth/mfa/oob/activate", {
      json: payload,
    });
    return {
      recoveryCodes: response.recovery_codes,
    };
  }

  async triggerOOB(authenticatorID?: string): Promise<void> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      authenticator_id: authenticatorID,
    });
    await this.post("/_auth/mfa/oob/trigger", {
      json: payload,
    });
  }

  async authenticateWithOOB(
    options: AuthenticateWithOOBOptions
  ): Promise<AuthResponse> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      request_bearer_token: options.skipMFAForCurrentDevice,
      code: options.code,
    });
    return this.postAndReturnAuthResponse("/_auth/mfa/oob/authenticate", {
      json: payload,
    });
  }

  async authenticateWithBearerToken(
    bearerToken?: string
  ): Promise<AuthResponse> {
    const payload = this.makePayloadWithAuthenticationSessionToken({
      bearer_token: bearerToken,
    });
    return this.postAndReturnAuthResponse(
      "/_auth/mfa/bearer_token/authenticate",
      {
        json: payload,
      }
    );
  }

  async revokeAllBearerToken(): Promise<void> {
    await this.post("/_auth/mfa/bearer_token/revoke_all", {
      json: {},
    });
  }

  /**
   * @internal
   */
  async _presignUpload(
    req: _PresignUploadRequest
  ): Promise<_PresignUploadResponse> {
    return this.post("/_asset/presign_upload", {
      json: req,
    });
  }

  /**
   * @internal
   */
  async _presignUploadForm(): Promise<_PresignUploadFormResponse> {
    return this.post("/_asset/presign_upload_form", {
      json: {},
    });
  }

  /**
   * @internal
   */
  async _fetchOIDCConfiguration(): Promise<_OIDCConfiguration> {
    return this._fetchJSON(
      `${this.authEndpoint}/.well-known/openid-configuration`
    );
  }
}
