# WAFv2 web ACL for CloudFront — created only when enable_waf = true.
#
# CLOUDFRONT-scoped WAF resources must live in us-east-1 regardless of
# var.region, so this uses the aws.us_east_1 provider alias. The ACL is
# attached to the distribution via its `web_acl_id` argument (see frontend.tf).
#
# Rules, in order:
#   1. Rate limit — blocks a single IP exceeding var.waf_rate_limit reqs / 5min.
#   2. AWS Common rule set — OWASP-style broad protections.
#   3. Known bad inputs — exploit patterns AWS curates.
#   4. SQL injection rule set.
# Managed groups run in their default (block) action; each rule and the ACL
# emit CloudWatch metrics.

resource "aws_wafv2_web_acl" "cloudfront" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1
  name     = "${local.name_prefix}-cloudfront"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-sqli"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-sqli"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-waf"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${local.name_prefix}-cloudfront-waf" }
}
