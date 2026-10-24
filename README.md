SUPERMAN Proxy — Quick Start
Proxy Active? Open SUPERMAN → Proxy → Join Shared Proxy. That's it!

Proxy Inactive? Start one for everyone:
1. On this GitHub repository, click Code → Codespaces → Create codespace on main.
2. In the terminal, run this command
   npm ci --prefix superman-browser
  3. Then this one:
   node proxy-service.mjs
4. Open the Ports tab. Find the proxy's port and change Port Visibility to Public. Keep the proxy's login protection enabled.
5. Right-click the port and select Copy Port URL.
6. Open SUPERMAN → Proxy, paste the link into I'm Hosting, and click Share My Proxy.
Done! Everyone can click Join Shared Proxy while your Codespace is running. No need to send the link to the Owner.

When you stop the Codespace, somebody else can follow these same steps. If the link won't register, check that the proxy is running and the port is Public.
