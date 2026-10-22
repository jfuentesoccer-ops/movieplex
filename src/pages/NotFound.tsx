import { Link } from 'react-router-dom';
import { Empty } from '../components/Common';

export default function NotFound() {
  return (
    <div className="page">
      <Empty title="Page not found">
        <Link to="/" className="btn primary">
          Back to Board
        </Link>
      </Empty>
    </div>
  );
}
