# Project Manuals

**Antigravity OS - Global Governance & Operational Runbooks**

Version: 1.0.0  
License: Propriertary

---

## Overview

This repository serves as the single source of truth for Antigravity OS governance, architecture specifications, and operational runbooks. It provides the necessary contracts and playbooks for managing the self-evolving AI ecosystem.

## Scope

- **Primary**: Canonical documentation, protocol specifications (MAP, SVP), and system-wide playbooks.
- **Secondary**: Tooling for repository management, split execution, and CI/CD orchestration.

## Promotion Rules

- **Draft**: Documentation updates must be reviewed by at least one Lead Architect.
- **Canonical**: Protocol changes require a 72-hour review period and consensus from the Core Research Group.

## Run Commands

- **Validate Plan**: `pwsh -File .\tools\repo_split_plan.ps1 -Layout recommended`
- **Audit Logs**: `cat antigravity.log`

## Ownership

- **Lead**: @zerospawn01-coder (Chief Architect)
- **Support**: Antigravity OS Governance Board

---

## Technical Index

- **Foundational Protocols**: [REPO_SPLIT_MCP_V0_1_SPEC.md](REPO_SPLIT_MCP_V0_1_SPEC.md)
- **Deployment Runbooks**: [REPO_SPLIT_POWERSHELL_RUNBOOK.md](REPO_SPLIT_POWERSHELL_RUNBOOK.md)
- **Execution Playbooks**: [SPLIT_EXECUTION_PLAYBOOK.md](SPLIT_EXECUTION_PLAYBOOK.md)

## Status

**Current Status**: Stable (v1.0.0)  
**Security**: Publicly readable, Write-access restricted to Governance Board.
