# Security Policy

## Supported versions

This project is currently a technical preview. Only the latest published
technical-preview release is considered for security fixes. No long-term
support promise is made yet.

## Reporting a vulnerability

Email <dtzhlq@126.com> with:

- the affected version and operating system;
- reproducible steps or a minimal proof of concept;
- the security impact you observed;
- whether the report contains sensitive model data or local paths.

Please do not open a public issue before the report has been assessed. Remove
credentials, personal information, customer models, and unrelated files from
the report whenever possible.

Receipt and remediation time are not guaranteed during the technical-preview
stage. The maintainer will try to acknowledge a valid report and coordinate
disclosure when contact details are available.

## Security boundary

The supported runtime is local and uses loopback or local filesystem queue
transport. It is not designed to expose the MCP server directly to a public
network. Agent-initiated mutations are subject to capability, target, approval,
and path checks; those controls reduce risk but do not make generated model
operations risk-free.
