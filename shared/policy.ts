export interface PolicyConfiguration {
  publicRegistrationEnabled: boolean;
  demoEnabled: boolean;
  closedTestNoticeVersion: string;
  termsVersion: string | null;
  privacyVersion: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  supportEmail: string | null;
}
