const ALLOWED_ORIGIN = "https://servicesolutionpadang-bit.github.io";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response("Forbidden", {status: 403});
      return new Response(null, {status: 204, headers: cors});
    }

    if (origin !== ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ok:false,error:"Origin tidak diizinkan."}), {
        status:403, headers:{...cors,"Content-Type":"application/json"}
      });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ok:false,error:"Gunakan POST."}), {
        status:405, headers:{...cors,"Content-Type":"application/json"}
      });
    }
    if (!env.GAS_URL || !env.API_SECRET) {
      return new Response(JSON.stringify({ok:false,error:"Worker belum dikonfigurasi."}), {
        status:500, headers:{...cors,"Content-Type":"application/json"}
      });
    }

    try {
      const input = await request.json();
      const upstream = await fetch(env.GAS_URL, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          secret:env.API_SECRET,
          fn:input.fn,
          arg:input.arg
        }),
        redirect:"follow"
      });
      const text = await upstream.text();
      return new Response(text, {
        status:upstream.ok ? 200 : upstream.status,
        headers:{...cors,"Content-Type":"application/json; charset=utf-8"}
      });
    } catch (err) {
      return new Response(JSON.stringify({ok:false,error:String(err)}), {
        status:502, headers:{...cors,"Content-Type":"application/json"}
      });
    }
  }
};
