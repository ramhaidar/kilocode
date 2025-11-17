---
title: Deploy
sidebar_position: 7
---

# Deploy

Kilo Code Deploy lets you ship Next.JS applications directly from Kilo Code. It automatically detects your stack, configures your project for hosting, and manages the full deployment lifecycle.

## What Deploy Does

Deploy is built to streamline the entire process of getting an app live:

- **One-click deployment** from the Kilo Code dashboard
- **Zero manual config** — Kilo Code generates and manages deployment settings  
- **Deployment history** with logs for each build

## Prerequisites

- Kilo Code Deploy is currently only supported within **Organizations**.
  - You can to **start a free trial** of [Kilo Plans](/docs/plans/about) and create an Organization [here](https://app.kilocode.ai/organizations/new).
- Your project must use **Next.js 14/15**
- You must enable the Kilo Code **Integration** for Github
  - Navigate to **your [Organization](https://app.kilocode.ai/organizations/) > Integrations > Github**  and click **Configure**.
  - Follow the instructions to connect Github to Kilo Code


## Deploying Your App

### 1. Open the Deploy Tab

- Navigate to your [Organzition dashboard](https://app.kilocode.ai/organizations) and select the **Deploy Tab**

### 2. Select Your Project

- Click **New Deployment**
- Select the **Github Integration** on the Integration dropdown menu
- Locate and select the project repository and branch

<img width="600" height="443" alt="DeploySelection" src="https://github.com/user-attachments/assets/e592a7c1-a2dd-42e3-ba5d-d86d9b61001f" />


### 4. Click **Deploy**

Kilo Code will:

- Build your project  
- Upload artifacts  
- Provision a deployment  
- Stream logs in real time  

When complete, you’ll receive a **deployment URL** you can open or share.

<img width="800" height="824" alt="DeploySuccess" src="https://github.com/user-attachments/assets/4a01ad52-1783-443f-9f9e-bfc2d4b77b43" />


## Deployment History & Rollbacks

Each deployment is saved automatically with:

- Timestamp  
- Build logs  
- Preview/Production URL  

From the history view, you can:

- Inspect previous builds  
- Restore a stable version  
- Compare outputs across deployments  

## Common Use Cases

Deploy is ideal for:

1. **Quick prototypes** — instantly push an idea live  
2. **Staging environments** — ship a preview version for teammates  
3. **Rapid iteration** with quick rebuilds


