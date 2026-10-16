/* Configuração do painel de contratos da Secretaria do Trabalho. */
const CONFIG = {
  csvUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH1haVymKYDsYJ6iEbMo5Z_IBSvGaN-Ad7FWuMsvCxxW-Ntw3fJjMwfzEDY4FKpLWdV8GfbAP8R4Su/pub?output=csv",
  sheetUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH1haVymKYDsYJ6iEbMo5Z_IBSvGaN-Ad7FWuMsvCxxW-Ntw3fJjMwfzEDY4FKpLWdV8GfbAP8R4Su/pubhtml",
  frequenciaCsvUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQHU9t4FJmFo-KUJ3oSG_PcAzjDxm8tbVxgbhWJPe8h0ipqtzdLPV-1qyS7BTCPYK4wCKpX7q-2VCr0/pub?output=csv",
  frequenciaSheetUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQHU9t4FJmFo-KUJ3oSG_PcAzjDxm8tbVxgbhWJPe8h0ipqtzdLPV-1qyS7BTCPYK4wCKpX7q-2VCr0/pubhtml",
  cacheKey: "set-contratos-cache-v1",
  alertaCritico: 45,
  alertaAtencao: 100,
  pageSize: 15,
  pageSizes: [15, 30, 50, 100],
  supabaseUrl: "https://ftuycoafwraxaachidlh.supabase.co",
  supabaseKey: "sb_publishable_ChSkjs3XsoxyoAKAHF-P1A_kXT4cb2M",
  ssoAuthority: "https://sso.idt.org.br",
  ssoClientId: "set_contratos",
  ataFunction: "ata",
};
