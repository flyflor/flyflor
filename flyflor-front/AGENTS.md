# Flyflor Front Agent Rules

本目录是 Flyflor 官网前端，使用 Bun + Nuxt 开发。

硬性规则：

- 只使用 Bun 命令管理依赖和脚本。
- 所有仓库文件使用 4 个空格缩进，不使用 tab。
- Vue SFC 必须按 `<template>`、`<script setup lang="ts">`、`<style scoped>` 顺序排列；不允许 script 在 template 前。
- 文件命名沿用主仓库点分风格；组件使用 PascalCase `.vue`。
- 双语内容必须同时维护英文和中文，不允许只改一种语言。
- 社区、市场和登录使用 Nuxt server routes + SQLite；数据库文件不得提交，OAuth 密钥只走运行时环境配置。
- 提交前运行 `bun run check`。
