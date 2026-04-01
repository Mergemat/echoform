export declare const DEFAULT_SERVER_HOST: string;
export declare const DEFAULT_SERVER_PORT: number;

export declare function resolveStartupConfig(
  env: NodeJS.ProcessEnv,
  createToken?: () => string
): {
  rendererUrl: string | null;
  apiBaseUrlOverride: string | null;
  sessionBootstrapToken: string;
};
