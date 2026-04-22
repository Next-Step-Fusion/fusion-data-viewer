export default {
  match: {
    requiredPaths: ["/NSFS/OUTPUT/IP/data", "/NSFS/OUTPUT/EDENS/data"],
  },
  dashboards: [
    {
      name: "NSFS Overview",
      layout: { gridColumns: 2, syncHover: true, syncSliders: false },
      plots: [
        { title: "Plasma Current",       xPath: "/NSFS/OUTPUT/IP/dim_0",    yPath: "/NSFS/OUTPUT/IP/data" },
        { title: "Loop Voltage",          xPath: "/NSFS/OUTPUT/VLOOP/dim_0", yPath: "/NSFS/OUTPUT/VLOOP/data" },
        { title: "Safety Factor (q0/q95)", xPath: "/NSFS/OUTPUT/Q0/dim_0",  yPath: "/NSFS/OUTPUT/Q0/data",
          additionalYPaths: ["/NSFS/OUTPUT/Q95/data"] },
        { title: "Beta Poloidal",         xPath: "/NSFS/OUTPUT/BETAP/dim_0", yPath: "/NSFS/OUTPUT/BETAP/data" },
        { title: "Elongation",            xPath: "/NSFS/OUTPUT/KAPPA/dim_0", yPath: "/NSFS/OUTPUT/KAPPA/data" },
        { title: "Internal Inductance",   xPath: "/NSFS/OUTPUT/LI/dim_0",    yPath: "/NSFS/OUTPUT/LI/data" },
      ],
    },
    {
      name: "NSFS Profiles",
      layout: { gridColumns: 2, syncSliders: true, syncHover: false },
      plots: [
        { title: "Electron Density",      xPath: "/NSFS/OUTPUT/EDENS/dim_1", yPath: "/NSFS/OUTPUT/EDENS/data", yMode: "2d", sliceAxis: 0 },
        { title: "Electron Temperature",  xPath: "/NSFS/OUTPUT/ETEMP/dim_1", yPath: "/NSFS/OUTPUT/ETEMP/data", yMode: "2d", sliceAxis: 0 },
        { title: "Ion Temperature",       xPath: "/NSFS/OUTPUT/ITEMP/dim_1", yPath: "/NSFS/OUTPUT/ITEMP/data", yMode: "2d", sliceAxis: 0 },
        { title: "q Profile",             xPath: "/NSFS/OUTPUT/Q/dim_1",     yPath: "/NSFS/OUTPUT/Q/data",     yMode: "2d", sliceAxis: 0 },
      ],
    },
    {
      name: "NSFS Flux",
      layout: { gridColumns: 1 },
      plots: [
        { title: "Poloidal Flux (ψ)", yPath: "/NSFS/OUTPUT/PSIRZ/data", yMode: "heatmap", sliceAxis: 0 },
      ],
    },
  ],
};
