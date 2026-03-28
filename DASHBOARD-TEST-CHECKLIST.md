# Dashboard UI Test Checklist — Tested 2026-03-28

## Login Page
- [x] Login page loads
- [x] Correct password ("admin") logs in
- [x] Redirects to Overview after login

## Overview Page
- [x] Page loads without crash
- [x] Stats cards show (Total Users, Active Now, Prompts Today, Credits Today)
- [x] User cards display with stats
- [x] Live Feed section with WebSocket connection

## Users Page
- [x] Page loads, shows user list (17 Users)
- [x] Tamper status column shows (Active/Killed/Paused icons)
- [x] "Add User" button opens modal
- [x] Add User modal: create user with name + slug → SUCCESS
- [x] Add User modal: shows auth token (clwt_newtestuser_...)
- [x] Add User modal: shows plugin install instructions (3 steps)
- [x] Click user name → navigates to user detail
- [x] Action buttons visible (Resume, Pause, Kill, Delete)

## User Detail Page
- [x] Page loads with user info (heading, stats)
- [x] Pause, Edit Limits, Kill User buttons present
- [x] Total Prompts, Credits, Sessions stats display
- [x] AI Summary section with Generate button
- [x] Rate Limits section with Edit button
- [x] Devices section

## Analytics Page
- [x] Page loads without crash
- [x] Team Leaderboard table renders
- [x] Credits by User section
- [x] Credits by Model section
- [x] Credits by Project section
- [x] Daily Credit Trend section
- [x] (Charts have layout warnings in headless — expected)

## Prompts Browser Page
- [x] Page loads without crash

## Summaries Page
- [x] Page loads without crash

## Audit Log Page
- [x] Page loads without crash

## Subscriptions Page
- [x] Page loads without crash

## Settings Page
- [x] Page loads without crash

## Bug Fixes Applied
- [x] All pages: `.users` → `.data`, `.leaderboard` → `.data`, `.summaries` → `.data`, etc.
- [x] tamper_status: handle both string and object `{status, unresolvedAlerts}` formats
- [x] AddUserModal: `.install_code` → `.auth_token`
- [x] Credits field: normalize across `credits`, `cost_usd`, `cost` field names
