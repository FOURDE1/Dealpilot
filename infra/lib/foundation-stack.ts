import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam, aws_route53 as route53, aws_ses as ses } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const DOMAIN = '1dealer.ca';
const GITHUB_REPO = 'FOURDE1/Dealpilot';

/**
 * A-07 unit 1 — the free foundation:
 * - SES domain identity for 1dealer.ca with Easy DKIM; the CDK construct
 *   writes the DKIM CNAMEs into the Route 53 zone automatically (the zone
 *   already lives in this account), plus a custom MAIL FROM subdomain so
 *   SPF/DMARC align. Email = SES per owner decision D-029.
 * - GitHub Actions OIDC provider + a deploy role trusting ONLY this repo's
 *   main/develop branches (no long-lived keys — CLAUDE.md/D-026). The role
 *   starts with read-only diff permissions; deploy permissions are added by
 *   the unit that introduces each deployable resource.
 */
export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: DOMAIN });

    const identity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.publicHostedZone(zone),
      mailFromDomain: `mail.${DOMAIN}`,
    });

    // Route 53 already covers DKIM records via Identity.publicHostedZone.
    // MAIL FROM needs its MX + SPF TXT records:
    new route53.MxRecord(this, 'MailFromMx', {
      zone,
      recordName: `mail.${DOMAIN}`,
      values: [{ priority: 10, hostName: `feedback-smtp.${this.region}.amazonses.com` }],
    });
    new route53.TxtRecord(this, 'MailFromSpf', {
      zone,
      recordName: `mail.${DOMAIN}`,
      values: ['v=spf1 include:amazonses.com ~all'],
    });

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'dealpilot-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${GITHUB_REPO}:ref:refs/heads/main`,
            `repo:${GITHUB_REPO}:ref:refs/heads/develop`,
          ],
        },
      }),
      description: 'CI deploys for FOURDE1/Dealpilot via OIDC — no long-lived keys',
      maxSessionDuration: cdk.Duration.hours(1),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DescribeOnlyUntilDeploysExist',
        actions: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
        resources: ['*'],
      }),
    );

    new cdk.CfnOutput(this, 'SesIdentityName', { value: identity.emailIdentityName });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
