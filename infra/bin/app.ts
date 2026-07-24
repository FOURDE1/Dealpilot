import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';

/**
 * Dealpilot infra (A-07) — everything lives in ca-central-1 (D-002 residency).
 * Account 242626139373, profile `Dealpilot` (owner-provisioned, D-029 note).
 * Unit 1 = zero/near-zero-cost foundation: SES + GitHub OIDC deploy role.
 * Costed resources (VPC/ECS/RDS/CloudFront) land in later units, each flagged
 * to the owner before `cdk deploy`.
 */
const app = new cdk.App();

new FoundationStack(app, 'DealpilotFoundation', {
  env: { account: '242626139373', region: 'ca-central-1' },
  description: '1Dealer foundation: SES domain identity + DKIM, GitHub Actions OIDC deploy role (A-07 unit 1)',
});

cdk.Tags.of(app).add('project', 'dealpilot');
cdk.Tags.of(app).add('managed-by', 'cdk');
