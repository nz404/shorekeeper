import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const width = 800; // px
const height = 400; // px
const chartCallback = (ChartJS: any) => {
    ChartJS.defaults.color = '#ffffff'; // Warna teks putih agar kontras di Telegram
};
const canvasRenderService = new ChartJSNodeCanvas({ width, height, chartCallback });

/** Membuat grafik trafik download dan upload MikroTik. */
export const generateMikrotikChart = async (alias: string, stats: any[]) => {
    const labels = stats.map(s => new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    const rxData = stats.map(s => s.rx_val);
    const txData = stats.map(s => s.tx_val);

    const configuration = {
        type: 'line' as const,
        data: {
            labels,
            datasets: [
                {
                    label: 'Download (Mbps)',
                    data: rxData,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Upload (Mbps)',
                    data: txData,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            plugins: {
                title: { display: true, text: `Traffic Stats: ${alias}`, font: { size: 20 } }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } },
                x: { grid: { display: false } }
            }
        }
    };

    return await canvasRenderService.renderToBuffer(configuration);
};