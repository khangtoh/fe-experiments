// Minimal host server for the experiments listing. Copy experiments-routes.js
// next to this file (or require it from the installed skill) and run:
//   node serve.js    ->  http://localhost:3000/fe-experiments
const express = require('express');
const path = require('path');
const { experimentsRouter } = require('./experiments-routes');

const ROOT = path.join(__dirname, '..');   // the site root, where fe-experiments/ lives
const app = express();
// redirect:false matters: with Express's default, /fe-experiments (a directory
// on disk) 301s to a trailing slash and the router below never runs.
app.use(express.static(ROOT, { index: false, redirect: false, dotfiles: 'deny' }));
app.use(experimentsRouter({ root: ROOT, name: 'fdeploy' }));
app.use((req, res) => res.status(404).type('text/plain').send('404 Not Found'));
app.listen(process.env.PORT || 3000);
